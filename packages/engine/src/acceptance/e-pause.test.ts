import { describe, expect, it } from "vitest";
import { seasonDay } from "../calendar/season-calendar";
import type { Fraction } from "../fraction/fraction";
import type { SessionResult } from "../opportunity/per-session";
import { pauseAwareWeekSessions } from "../pause/pause-aware-week";
import { prorateSessionCount } from "../pause/proration";
import { scorePerSessionCommitment } from "../scoring/commitment-score";
import {
  buildDoneEntry,
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
} from "../test-support/builders";
import { fr } from "../test-support/fraction-literal";
import {
  eAllCommitmentsPause,
  eConsistencyRows,
  eLifecycleRows,
  eNeutralPointsRows,
  ePausedDaySessionRows,
  eSessionCountRows,
  eWeeklyProrationRows,
  type NeutralPointsRow,
} from "./rows/e-pause.rows";

/** Every row family below calls ONLY `pauseAwareWeekSessions` (the production composition
 * function) or `prorateSessionCount` (a pure production unit) — no pause/proration/grace/dispatch
 * logic is written here. This file builds fixtures and compares the function's own output. */

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
    );
    if (result.status === "scored") sessions.push(...result.sessions);
  }
  return scorePerSessionCommitment(row.weightPercent, sessions).points;
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
      );
      expect(result.status).toBe("paused");
    }
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
      );
      if (result.status === "scored") sessions.push(...result.sessions);
    }
    expect(scorePerSessionCommitment(row.weightPercent, sessions).consistency).toEqual(
      row.expectedConsistency,
    );
  });
});
