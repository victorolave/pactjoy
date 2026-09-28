import { describe, expect, it } from "vitest";
import type { Season, Weekday } from "../calendar/season-calendar.ts";
import { seasonDay } from "../calendar/season-calendar.ts";
import type { Entry } from "../entry/entry.ts";
import type { Fraction } from "../fraction/fraction.ts";
import type { SessionResult } from "../opportunity/per-session.ts";
import { pauseAwareWeekSessions } from "../pause/pause-aware-week.ts";
import { canRequestPause } from "../pause/pause-cap.ts";
import { prorateSessionCount } from "../pause/proration.ts";
import { scoreCommitmentSoFar } from "../scoring/commitment-score.ts";
import type { ScoreInput } from "../scoring/member-score.ts";
import { scoreMember } from "../scoring/member-score.ts";
import {
  buildDoneCommitment,
  buildDoneEntry,
  buildMissedEntry,
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
} from "../test-support/builders.ts";
import { fr } from "../test-support/fraction-literal.ts";
import {
  eAllCommitmentsPause,
  eAutoResumeRows,
  eConsistencyRows,
  eLifecycleRows,
  eNeutralPointsRows,
  ePauseCapRows,
  ePausedDaySessionRows,
  eSessionCountRows,
  eWeeklyProrationRows,
  type NeutralPointsRow,
} from "./rows/e-pause.rows.ts";

/** Every row family below calls ONLY `pauseAwareWeekSessions` (the production composition
 * function) or `prorateSessionCount` (a pure production unit) — no pause/proration/grace/dispatch
 * logic is written here. This file builds fixtures and compares the function's own output. */

/** None of the E-series rows below are about D9's cap itself (that's `ePauseCapRows`, exercised
 * via `canRequestPause` directly) — this season only satisfies the now-required
 * `options.season`. Its 12-week/84-day length is far above the longest pause span used by any
 * row here (14 days, E1/E23), so the default cap never engages and every row's expected value
 * is unaffected. */
const acceptanceSeason: Season = { lengthWeeks: 12, startWeekday: 0 };

function fullWeekEntries(
  commitmentId: string,
  week: number,
  times: number,
): readonly ReturnType<typeof buildDoneEntry>[] {
  return Array.from({ length: times }, (_, i) => buildDoneEntry(commitmentId, week * 7 + i));
}

function pointsFor(row: NeutralPointsRow): Fraction {
  const sessions: SessionResult[] = [];
  for (let week = 0; week < row.weeksCount; week++) {
    const entries = row.fullWeeks.includes(week)
      ? fullWeekEntries("leer", week, row.timesPerWeek)
      : [];
    const result = pauseAwareWeekSessions(
      row.commitment,
      week,
      row.pauses,
      entries,
      seasonDay(row.today),
      {
        season: acceptanceSeason,
      },
    );
    if (result.status === "scored") sessions.push(...result.sessions);
  }
  return scoreCommitmentSoFar(row.weightPercent, sessions, sessions).points;
}

describe("acceptance: series E — pause (neutral points)", () => {
  it.for(eNeutralPointsRows)("$id: $summary", (row) => {
    expect(pointsFor(row)).toEqual(row.expectedPoints);
  });
});

describe("acceptance: series E — timesPerWeek proration (D6/D7, pure function)", () => {
  it.for(eSessionCountRows)("$id: $summary", (row) => {
    expect(prorateSessionCount(row.times, row.activeDays)).toBe(row.expected);
  });
});

describe("acceptance: series E — weeklyTotal proration (D6/D7), through the composition function", () => {
  it.for(eWeeklyProrationRows)("$id: $summary", (row) => {
    if (row.expectedPaused) {
      const result = pauseAwareWeekSessions(
        row.commitment,
        0,
        row.pauses,
        [],
        seasonDay(row.today),
        {
          season: acceptanceSeason,
        },
      );
      expect(result.status).toBe("paused");
      return;
    }
    for (const testValue of row.testValues) {
      const entries = [buildQuantityEntry("row", 6, testValue.total)]; // day 6 is always active in these fixtures
      const result = pauseAwareWeekSessions(
        row.commitment,
        0,
        row.pauses,
        entries,
        seasonDay(row.today),
        { season: acceptanceSeason },
      );
      expect(result.status).toBe("scored");
      if (result.status !== "scored") throw new Error("unreachable");
      expect(result.sessions[0]?.progress).toEqual(testValue.expectedProgress);
      expect(result.sessions[0]?.consistent).toBe(testValue.expectedConsistent);
    }
  });
});

describe("acceptance: series E — a session on a paused day does not count (D8)", () => {
  it.for(ePausedDaySessionRows)("$id: $summary", (row) => {
    const result = pauseAwareWeekSessions(
      row.commitment,
      0,
      row.pauses,
      row.entries,
      seasonDay(row.today),
      { season: acceptanceSeason },
    );
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions.map((s) => s.progress)).toEqual(row.expectedProgresses);
  });
});

describe("acceptance: series E — pause request lifecycle timing", () => {
  it.for(eLifecycleRows)("$id: $summary", (row) => {
    const result = pauseAwareWeekSessions(
      row.commitment,
      row.week,
      row.pauses,
      row.entries,
      seasonDay(row.today),
      { season: acceptanceSeason },
    );
    expect(result.status).toBe(row.expectedStatus);
    if (result.status === "scored" && row.expectedProgresses) {
      expect(result.sessions.map((s) => s.progress)).toEqual(row.expectedProgresses);
    }
  });

  it(`${eAllCommitmentsPause.id}: ${eAllCommitmentsPause.summary}`, () => {
    for (const commitmentId of eAllCommitmentsPause.commitmentIds) {
      const commitment = buildQuantityCommitment(
        commitmentId,
        20,
        "times",
        { direction: "reach", minimum: fr("1"), ideal: fr("1") },
        { kind: "timesPerWeek", times: 3 },
      );
      const pauses = [
        buildPauseRequest(
          commitmentId,
          eAllCommitmentsPause.startDay,
          { kind: "fixed", lastDay: seasonDay(eAllCommitmentsPause.lastDay) },
          {
            kind: "approved",
            decidedOn: seasonDay(eAllCommitmentsPause.startDay),
            resumedOn: null,
          },
        ),
      ];
      // week 3 (days 21-27) sits entirely inside the 7-day vacation (21-27) -> fully paused, independently, per commitment.
      const result = pauseAwareWeekSessions(
        commitment,
        eAllCommitmentsPause.week,
        pauses,
        [],
        seasonDay(eAllCommitmentsPause.today),
        { season: acceptanceSeason },
      );
      expect(result.status).toBe("paused");
    }
  });
});

describe("acceptance: series E — canRequestPause 50% cap, retroactive guard, early-resume consumption (D9)", () => {
  it.for(ePauseCapRows)("$id: $summary", (row) => {
    const result = canRequestPause(
      row.season,
      row.history,
      { startDay: seasonDay(row.request.startDay), end: row.request.end },
      seasonDay(row.today),
    );
    expect(result).toEqual(row.expected);
  });
});

describe("acceptance: series E — an open pause auto-resumes at the D9 cap (E15)", () => {
  it.for(eAutoResumeRows)("$id: $summary", (row) => {
    // `pauseCap` is explicit here (Notion states the rule qualitatively, not the exact day
    // numbers — see the row's own doc comment), so `acceptanceSeason` only satisfies the
    // now-required `options.season` and never contributes to the outcome.
    const stillPaused = pauseAwareWeekSessions(
      row.commitment,
      row.weekStillPaused,
      row.pauses,
      [],
      seasonDay(row.today),
      { season: acceptanceSeason, pauseCap: row.pauseCap },
    );
    expect(stillPaused.status).toBe("paused");

    const resumed = pauseAwareWeekSessions(
      row.commitment,
      row.weekAutoResumed,
      row.pauses,
      row.entriesForResumedWeek,
      seasonDay(row.today),
      { season: acceptanceSeason, pauseCap: row.pauseCap },
    );
    expect(resumed.status).toBe("scored");
    if (resumed.status !== "scored") throw new Error("unreachable");
    expect(resumed.sessions.map((s) => s.progress)).toEqual(row.expectedProgresses);
  });
});

describe("acceptance: series E — consistency excludes paused opportunities", () => {
  it.for(eConsistencyRows)("$id: $summary", (row) => {
    const sessions: SessionResult[] = [];
    for (let week = 0; week < row.weeksCount; week++) {
      let entries: readonly ReturnType<typeof buildDoneEntry>[] = [];
      if (row.fullWeeks.includes(week)) {
        entries = fullWeekEntries("leer", week, 5);
      } else if (week === row.partialWeek) {
        entries = [buildDoneEntry("leer", week * 7), buildDoneEntry("leer", week * 7 + 1)]; // 2 done, 3 miss
      }
      const result = pauseAwareWeekSessions(
        row.commitment,
        week,
        row.pauses,
        entries,
        seasonDay(row.today),
        { season: acceptanceSeason },
      );
      if (result.status === "scored") sessions.push(...result.sessions);
    }
    expect(scoreCommitmentSoFar(row.weightPercent, sessions, sessions).consistency).toEqual(
      row.expectedConsistency,
    );
  });

  it(`${eConsistencyRows[0]?.id}: streak-freeze half (D11) — the paused weeks neither break nor extend the streak`, () => {
    // Exercised through scoreMember ONLY (fresh-review BLOCKER fix) -- no direct composition of
    // pauseAwareWeekSessions + weekStreakOutcome + computeStreak in this test body; that
    // composition now lives in scoring/member-score.ts's own seasonSessions.
    const row = eConsistencyRows[0];
    if (row === undefined) throw new Error("unreachable");
    const entries: Entry[] = [];
    for (let week = 0; week < row.weeksCount; week++) {
      if (row.fullWeeks.includes(week)) {
        entries.push(...fullWeekEntries("leer", week, 5));
      } else if (week === row.partialWeek) {
        entries.push(buildDoneEntry("leer", week * 7), buildDoneEntry("leer", week * 7 + 1));
      }
    }
    const input: ScoreInput = {
      season: acceptanceSeason,
      commitments: [row.commitment],
      entries,
      pauses: row.pauses,
      today: seasonDay(row.today),
    };
    const score = scoreMember(input);
    // Weeks 0,1 kept (best 2 so far) -> weeks 2,3 (paused) frozen, unchanged at 2 -> weeks 4,5,6
    // kept, extending past the freeze to a new best of 5 -> week 7 (partial, 2 of 5) breaks it.
    expect(score.commitments[0]?.streak).toEqual({ unit: "week", current: 0, best: 5 });
  });

  it("specificDays streak (D11, engine-authored): a day-bound commitment's streak, exercised through scoreMember, exercises dayStreakOutcome through production", () => {
    const tuesday: Weekday = 1;
    const dibujar = buildDoneCommitment("dibujar", 100, {
      kind: "specificDays",
      weekdays: [tuesday],
    });
    const input: ScoreInput = {
      season: { lengthWeeks: 4, startWeekday: 0 },
      commitments: [dibujar],
      // Week 0's tuesday (day 1): done -- kept. Week 1's tuesday (day 8): explicit miss -- broken.
      // Weeks 2-3's tuesdays: no entry, and (today = 15) still within their own grace -- frozen
      // (not yet due), proving a not-yet-counted day freezes the streak just like a paused one.
      entries: [buildDoneEntry("dibujar", 1), buildMissedEntry("dibujar", 8)],
      pauses: [],
      today: seasonDay(15), // past day 8's graceDeadline (9), short of day 15's/22's (16/23)
    };
    const score = scoreMember(input);
    expect(score.commitments[0]?.streak).toEqual({ unit: "day", current: 0, best: 1 });
  });
});
