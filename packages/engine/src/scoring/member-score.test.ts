import { describe, expect, it } from "vitest";
import type { Season, Weekday } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import { fromInt } from "../fraction/fraction";
import { buildDoneCommitment, buildDoneEntry, buildPauseRequest } from "../test-support/builders";
import { fr } from "../test-support/fraction-literal";
import type { ScoreInput } from "./member-score";
import { scoreMember } from "./member-score";

const fourWeekSeason: Season = { lengthWeeks: 4, startWeekday: 0 };

/**
 * The tests below use `today: seasonDay(28)`, not `27` — day 27 is the
 * season's LAST day, but R1 (D12's "so far" counting rule, slice 6b) only
 * counts a week-bound opportunity once its OWN grace period has also
 * passed: `today >= graceDeadline(weekEnd) = weekEnd + 1`. For this season's
 * last week (weekEnd = 27), that deadline is day 28. Every entry in these
 * fixtures is already recorded well before day 27, so bumping `today` from
 * 27 to 28 changes nothing about which entries are visible — it only
 * finishes closing the season's own last week under the new rule,
 * preserving every one of these tests' original expected values exactly.
 */

function fullWeekEntries(
  commitmentId: string,
  week: number,
  times: number,
): readonly ReturnType<typeof buildDoneEntry>[] {
  return Array.from({ length: times }, (_, i) => buildDoneEntry(commitmentId, week * 7 + i));
}

describe("scoreMember", () => {
  it("returns points 0 and null consistency/idealCompletion for zero commitments (R6, engine-authored)", () => {
    const input: ScoreInput = {
      season: fourWeekSeason,
      commitments: [],
      entries: [],
      pauses: [],
      today: seasonDay(28),
    };
    const score = scoreMember(input);
    expect(score.points).toEqual(fromInt(0));
    expect(score.consistency).toBeNull();
    expect(score.idealCompletion).toBeNull();
    expect(score.commitments).toEqual([]);
  });

  it("R6 with a real (non-empty) commitment: a whole-season exclusion (approved pause up to the D9 cap + a pending request for the remainder) leaves every week excluded -- points 0, consistency/idealCompletion null", () => {
    // A SINGLE approved pause cannot span the whole season: D9's 50% cap
    // (`seasonPauseCap`, enforced INSIDE `pauseAwareWeekSessions` itself, not
    // just at request time) auto-trims `effectivePausedDays` to the earliest
    // `cap` days (`capPausedDays`), so an approved pause over the full 28
    // days of this 4-week season would leave weeks 2-3 NOT paused -- they'd
    // score real (zero-progress, but COUNTED) opportunities, and consistency
    // would be `0`, not `null`. This was confirmed by first writing exactly
    // that (single full-season approved pause) and observing `consistency`
    // come back as `0/1`, not `null` -- not a bug, D9 working as designed
    // (slice 5b's SHOULD-FIX). To genuinely exclude every week while
    // respecting D9, this combines an approved pause for the cap-allowed
    // first 14 days with a still-PENDING request for the remaining 14 days
    // (`pendingHoldDays` is never capped -- only the approved `paused` set
    // is, per `pause-aware-week.ts`) -- both are real production code paths.
    const gym = buildDoneCommitment("gym", 100, { kind: "timesPerWeek", times: 3 });
    const pauses = [
      buildPauseRequest(
        "gym",
        0,
        { kind: "fixed", lastDay: seasonDay(13) }, // days 0-13: exactly the D9 cap (14 days) for a 4-week season
        { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
      ),
      buildPauseRequest(
        "gym",
        14,
        { kind: "fixed", lastDay: seasonDay(27) }, // days 14-27: the remaining half, still pending
        { kind: "pending" },
      ),
    ];
    const input: ScoreInput = {
      season: fourWeekSeason,
      commitments: [gym],
      entries: [],
      pauses,
      today: seasonDay(28),
    };
    const score = scoreMember(input);
    expect(score.commitments).toHaveLength(1); // R6 is about zero OPPORTUNITIES, not zero commitments
    expect(score.commitments[0]?.points).toEqual(fromInt(0));
    expect(score.commitments[0]?.consistency).toBeNull();
    expect(score.commitments[0]?.idealCompletion).toBeNull();
    expect(score.points).toEqual(fromInt(0));
    expect(score.consistency).toBeNull();
    expect(score.idealCompletion).toBeNull();
  });

  it("R6 with a real (non-empty) commitment: a whole-season PENDING pause (onHold, not yet decided) also excludes every week -- points 0, consistency/idealCompletion null", () => {
    const leer = buildDoneCommitment("leer", 100, { kind: "timesPerWeek", times: 5 });
    const pauses = [
      buildPauseRequest("leer", 0, { kind: "fixed", lastDay: seasonDay(27) }, { kind: "pending" }),
    ];
    const input: ScoreInput = {
      season: fourWeekSeason,
      commitments: [leer],
      entries: [],
      pauses,
      today: seasonDay(28),
    };
    const score = scoreMember(input);
    expect(score.commitments).toHaveLength(1);
    expect(score.commitments[0]?.points).toEqual(fromInt(0));
    expect(score.commitments[0]?.consistency).toBeNull();
    expect(score.commitments[0]?.idealCompletion).toBeNull();
    expect(score.points).toEqual(fromInt(0));
    expect(score.consistency).toBeNull();
    expect(score.idealCompletion).toBeNull();
  });

  it("aggregates one commitment's whole season into points/consistency/idealCompletion (D1)", () => {
    const gym = buildDoneCommitment("gym", 100, { kind: "timesPerWeek", times: 3 });
    const entries = [
      ...fullWeekEntries("gym", 0, 3),
      ...fullWeekEntries("gym", 1, 3),
      ...fullWeekEntries("gym", 2, 2), // one missed session this week
      ...fullWeekEntries("gym", 3, 3),
    ];
    const input: ScoreInput = {
      season: fourWeekSeason,
      commitments: [gym],
      entries,
      pauses: [],
      today: seasonDay(28),
    };
    const score = scoreMember(input);
    // 11 of 12 sessions done -> mean progress = 11/12, points = 100 x 10 x 11/12 = 2750/3
    expect(score.commitments).toHaveLength(1);
    expect(score.commitments[0]?.commitmentId).toBe("gym");
    expect(score.commitments[0]?.points).toEqual(fr("2750/3"));
    expect(score.consistency).toEqual(fr("11/12"));
    expect(score.points).toEqual(fr("2750/3"));
    expect(score.idealCompletion).toEqual(fr("11/12")); // totalPoints / 1000 = (2750/3)/1000
  });

  it("computes participant consistency as Sigma(reached)/Sigma(opportunities), not an average of per-commitment ratios (D2)", () => {
    const gym = buildDoneCommitment("gym", 50, { kind: "timesPerWeek", times: 1 });
    const leer = buildDoneCommitment("leer", 50, { kind: "timesPerWeek", times: 3 });
    const entries = [
      ...fullWeekEntries("gym", 0, 1),
      ...fullWeekEntries("gym", 1, 1),
      ...fullWeekEntries("gym", 2, 1),
      ...fullWeekEntries("gym", 3, 1), // gym: 4 opportunities, 4 reached
      ...fullWeekEntries("leer", 0, 3), // leer: 12 opportunities, only week 0's 3 reached
    ];
    const input: ScoreInput = {
      season: fourWeekSeason,
      commitments: [gym, leer],
      entries,
      pauses: [],
      today: seasonDay(28),
    };
    const score = scoreMember(input);
    expect(score.commitments[0]?.consistency).toEqual(fromInt(1)); // gym: 4/4
    expect(score.commitments[1]?.consistency).toEqual(fr("1/4")); // leer: 3/12
    // D2: (4+3)/(4+12) = 7/16 -- NOT the naive average of 1 and 1/4 (which would be 5/8)
    expect(score.consistency).toEqual(fr("7/16"));
  });

  it("excludes a fully paused week from the season aggregation, via pauseAwareWeekSessions (D8, wiring)", () => {
    const gym = buildDoneCommitment("gym", 100, { kind: "timesPerWeek", times: 2 });
    const pauses = [
      buildPauseRequest(
        "gym",
        14,
        { kind: "fixed", lastDay: seasonDay(20) },
        { kind: "approved", decidedOn: seasonDay(14), resumedOn: null },
      ),
    ];
    const entries = [
      ...fullWeekEntries("gym", 0, 2),
      ...fullWeekEntries("gym", 1, 2),
      // week 2 (days 14-20) is fully paused -- excluded entirely, not scored as zero
      ...fullWeekEntries("gym", 3, 2),
    ];
    const input: ScoreInput = {
      season: fourWeekSeason,
      commitments: [gym],
      entries,
      pauses,
      today: seasonDay(28),
    };
    const score = scoreMember(input);
    // 3 active weeks x 2 sessions, all done -> 6/6 reached, full points at 100% weight
    expect(score.consistency).toEqual(fromInt(1));
    expect(score.commitments[0]?.points).toEqual(fromInt(1000));
  });

  it("R1 (week-bound): an in-progress week's partial entries do not prematurely count, even though the season-total denominator already expects that week's opportunities", () => {
    const gym = buildDoneCommitment("gym", 100, { kind: "timesPerWeek", times: 3 });
    const entries = [
      ...fullWeekEntries("gym", 0, 3), // week 0: fully done and closed
      buildDoneEntry("gym", 7), // week 1: only 1 of 3 sessions logged so far -- week still open
      // weeks 2, 3: nothing logged yet
    ];
    const input: ScoreInput = {
      season: fourWeekSeason,
      commitments: [gym],
      entries,
      pauses: [],
      today: seasonDay(10), // inside week 1 (days 7-13); its grace deadline is day 14 -- not yet
    };
    const score = scoreMember(input);
    // Denominator (D12: active opportunities of the whole season) is unaffected by R1: 4 weeks x 3 = 12.
    // Numerator counts ONLY week 0's 3 fully-resolved sessions -- week 1's early single entry is
    // NOT yet counted (R1), so it must NOT inflate points/consistency beyond week 0's contribution.
    // Without R1, week 1's 1 already-reached session would count too: reached 4/12, not 3/12.
    expect(score.commitments[0]?.points).toEqual(fromInt(250)); // 100 x 10 x 3/12
    expect(score.consistency).toEqual(fr("1/4")); // 3/12, NOT 4/12
    expect(score.idealCompletion).toEqual(fr("1/4"));
  });

  it("R1 (day-bound, specificDays): with every scheduled day still within grace and unentered, nothing is counted yet -- points 0, consistency/idealCompletion null (R6), not a premature 0%", () => {
    const tuesday: Weekday = 1;
    const dibujar = buildDoneCommitment("dibujar", 100, {
      kind: "specificDays",
      weekdays: [tuesday],
    });
    const input: ScoreInput = {
      season: fourWeekSeason,
      commitments: [dibujar],
      entries: [], // nothing logged yet
      pauses: [],
      today: seasonDay(0), // week 0's tuesday (day 1) hasn't happened yet; its grace deadline is day 2
    };
    const score = scoreMember(input);
    expect(score.commitments[0]?.points).toEqual(fromInt(0));
    expect(score.commitments[0]?.consistency).toBeNull();
    expect(score.commitments[0]?.idealCompletion).toBeNull();
    expect(score.consistency).toBeNull();
    expect(score.idealCompletion).toBeNull();
  });

  it("R1 (day-bound, specificDays): a scheduled day already has an explicit entry, so it counts immediately even though its own grace period hasn't passed yet", () => {
    const tuesday: Weekday = 1;
    const dibujar = buildDoneCommitment("dibujar", 100, {
      kind: "specificDays",
      weekdays: [tuesday],
    });
    const input: ScoreInput = {
      season: fourWeekSeason,
      commitments: [dibujar],
      entries: [buildDoneEntry("dibujar", 1)], // week 0's tuesday, logged same-day
      pauses: [],
      today: seasonDay(1), // day 1 itself -- grace deadline for day 1 is day 2, not reached yet
    };
    const score = scoreMember(input);
    // Denominator: 4 scheduled tuesdays across the season = 4. Numerator: only day 1 is counted
    // so far (via its entry, per R1's "OR has an entry" clause) -- weeks 1-3's tuesdays have no
    // entry and their own grace hasn't passed, so they contribute nothing yet.
    expect(score.commitments[0]?.points).toEqual(fromInt(250)); // 100 x 10 x 1/4
    expect(score.commitments[0]?.consistency).toEqual(fr("1/4"));
  });
});
