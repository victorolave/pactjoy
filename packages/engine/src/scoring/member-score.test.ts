import { describe, expect, it } from "vitest";
import type { Season } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import { fromInt } from "../fraction/fraction";
import { buildDoneCommitment, buildDoneEntry, buildPauseRequest } from "../test-support/builders";
import { fr } from "../test-support/fraction-literal";
import type { ScoreInput } from "./member-score";
import { scoreMember } from "./member-score";

const fourWeekSeason: Season = { lengthWeeks: 4, startWeekday: 0 };

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
      today: seasonDay(27),
    };
    const score = scoreMember(input);
    expect(score.points).toEqual(fromInt(0));
    expect(score.consistency).toBeNull();
    expect(score.idealCompletion).toBeNull();
    expect(score.commitments).toEqual([]);
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
      today: seasonDay(27),
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
      today: seasonDay(27),
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
      today: seasonDay(27),
    };
    const score = scoreMember(input);
    // 3 active weeks x 2 sessions, all done -> 6/6 reached, full points at 100% weight
    expect(score.consistency).toEqual(fromInt(1));
    expect(score.commitments[0]?.points).toEqual(fromInt(1000));
  });
});
