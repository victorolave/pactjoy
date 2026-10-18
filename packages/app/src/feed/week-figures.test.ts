import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { EntryRecord } from "../entry/entry.ts";
import type { EffectivePauseRequest } from "../pause/effective-pauses.ts";
import {
  ANDREA,
  approvedPause,
  feedWorld,
  LEER,
  leer,
  MEDITAR,
  meditar,
  minutes,
} from "./feed-fixtures.ts";
import {
  isConsistentWeek,
  isHardWeek,
  latestFinalWeek,
  memberWeeklySeries,
  pooledWeek,
} from "./week-figures.ts";

/** Andrea's weekly series for a world with the given entries, read on 0-based day `today`. */
function seriesOf(
  today: number,
  entries: readonly EntryRecord[],
  requests: readonly EffectivePauseRequest[] = [],
) {
  const world = feedWorld({ today, entries, requests, commitments: [meditar(), leer()] });
  return memberWeeklySeries({
    season: world.season,
    actualStart: world.actualStart,
    memberId: ANDREA,
    entries: world.entries,
    requests: world.requests,
    today: world.today,
  });
}

const allWeek = (week: number) =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => minutes(meditar(), week * 7 + d, "30"));
const some = (week: number, days: number[], commitment = meditar()) =>
  days.map((d) => minutes(commitment, week * 7 + d, "30"));
const reading = (week: number) => minutes(leer(), week * 7 + 2, "10");

describe("consistent week (one commitment, 100 % of its counted opportunities)", () => {
  it("is consistent when every counted opportunity of a final week reached the minimum", () => {
    const series = seriesOf(8, allWeek(0));
    const meditation = series.find((s) => s.commitmentId === MEDITAR);
    const week = meditation?.weeks[0];
    expect(week).toMatchObject({ final: true, counted: 7, kept: 7 });
    expect(week && isConsistentWeek(week, seasonDay(8))).toBe(true);
  });

  it("is not consistent with 6 of 7", () => {
    const series = seriesOf(8, some(0, [0, 1, 2, 3, 4, 5]));
    const week = series.find((s) => s.commitmentId === MEDITAR)?.weeks[0];
    expect(week).toMatchObject({ counted: 7, kept: 6 });
    expect(week && isConsistentWeek(week, seasonDay(8))).toBe(false);
  });

  it("is not consistent until the week is final (grace period over)", () => {
    // Week 0 ends on day 6; its grace day is day 7, so it is only final from day 8.
    const week = seriesOf(7, allWeek(0)).find((s) => s.commitmentId === MEDITAR)?.weeks[0];
    expect(week?.final).toBe(false);
    expect(week && isConsistentWeek(week, seasonDay(7))).toBe(false);
  });

  it("a week with nothing counted (fully paused) is not consistent", () => {
    const pause = approvedPause({
      startDay: seasonDay(0),
      end: { kind: "fixed", lastDay: seasonDay(6) },
      decidedOn: seasonDay(0),
    });
    const week = seriesOf(8, [], [pause]).find((s) => s.commitmentId === MEDITAR)?.weeks[0];
    expect(week).toMatchObject({ counted: 0, final: true });
    expect(week && isConsistentWeek(week, seasonDay(8))).toBe(false);
  });

  it("a pause shrinks the denominator: kept === counted over the active days is consistent", () => {
    const pause = approvedPause({
      startDay: seasonDay(5),
      end: { kind: "fixed", lastDay: seasonDay(6) },
      decidedOn: seasonDay(5),
    });
    const week = seriesOf(8, some(0, [0, 1, 2, 3, 4]), [pause]).find(
      (s) => s.commitmentId === MEDITAR,
    )?.weeks[0];
    expect(week).toMatchObject({ counted: 5, kept: 5 });
    expect(week && isConsistentWeek(week, seasonDay(8))).toBe(true);
  });
});

describe("hard week (pooled over the member's commitments, kept below half of counted)", () => {
  it("2 * kept < counted is hard", () => {
    // meditar 2 of 7 + leer 1 of 1 = 3 of 8.
    const series = seriesOf(8, [...some(0, [0, 1]), reading(0)]);
    const pooled = pooledWeek(series, 0);
    expect(pooled).toMatchObject({ counted: 8, kept: 3, final: true });
    expect(isHardWeek(pooled, 0, seasonDay(8))).toBe(true);
  });

  it("2 * kept === counted is NOT hard (exactly half)", () => {
    // meditar 3 of 7 + leer 1 of 1 = 4 of 8.
    const pooled = pooledWeek(seriesOf(8, [...some(0, [0, 1, 2]), reading(0)]), 0);
    expect(pooled).toMatchObject({ counted: 8, kept: 4 });
    expect(isHardWeek(pooled, 0, seasonDay(8))).toBe(false);
  });

  it("a week that is not final is never hard", () => {
    const pooled = pooledWeek(seriesOf(7, []), 0);
    expect(pooled.final).toBe(false);
    expect(isHardWeek(pooled, 0, seasonDay(7))).toBe(false);
  });

  it("a week with nothing counted is never hard (paused)", () => {
    const pause = approvedPause({
      startDay: seasonDay(0),
      end: { kind: "fixed", lastDay: seasonDay(6) },
      commitments: [
        { commitmentId: MEDITAR, resumedOn: null, resumedAt: null },
        { commitmentId: LEER, resumedOn: null, resumedAt: null },
      ],
      decidedOn: seasonDay(0),
    });
    const pooled = pooledWeek(seriesOf(8, [], [pause]), 0);
    expect(pooled.counted).toBe(0);
    expect(isHardWeek(pooled, 0, seasonDay(8))).toBe(false);
  });
});

/**
 * The engine's `final` for a non-empty week only means every opportunity is final, so a sparse
 * schedule closes the week early: a Mondays-only commitment is "final" on the week's last day, a
 * day before its grace is over (the grace day is day 7). The owner
 * rule is "at week close", the calendar week plus its grace: a week is closed once `today` is past
 * the grace deadline of its last day (week 0: day 8 and later).
 */
describe("a week closes with its calendar grace, not with its last opportunity", () => {
  /** One scheduled day a week: day 0 of each week. */
  const mondaysOnly = () =>
    meditar({
      measure: {
        ...meditar().measure,
        schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0] } },
      },
    });
  const seriesAt = (today: number, entries: readonly EntryRecord[], commitment = mondaysOnly()) => {
    const world = feedWorld({ today, entries, commitments: [commitment] });
    return memberWeeklySeries({
      season: world.season,
      actualStart: world.actualStart,
      memberId: ANDREA,
      entries: world.entries,
      requests: world.requests,
      today: world.today,
    });
  };
  const keptMonday = [minutes(mondaysOnly(), 0, "30")];

  it("the engine calls the sparse week final on its last day, before the grace is over", () => {
    expect(seriesAt(6, keptMonday)[0]?.weeks[0]).toMatchObject({
      final: true,
      counted: 1,
      kept: 1,
    });
  });

  it.each([5, 6, 7])("a kept sparse week is not consistent on day %i", (today) => {
    const week = seriesAt(today, keptMonday)[0]?.weeks[0];
    expect(week && isConsistentWeek(week, seasonDay(today))).toBe(false);
  });

  it("a kept sparse week is consistent from day 8", () => {
    const week = seriesAt(8, keptMonday)[0]?.weeks[0];
    expect(week && isConsistentWeek(week, seasonDay(8))).toBe(true);
  });

  it.each([5, 6, 7])("a missed sparse week is not hard nor the latest final on day %i", (today) => {
    const series = seriesAt(today, []);
    expect(isHardWeek(pooledWeek(series, 0), 0, seasonDay(today))).toBe(false);
    expect(latestFinalWeek(series, seasonDay(today))).toBeNull();
  });

  it("a missed sparse week is hard, and the latest final one, from day 8", () => {
    const series = seriesAt(8, []);
    expect(isHardWeek(pooledWeek(series, 0), 0, seasonDay(8))).toBe(true);
    expect(latestFinalWeek(series, seasonDay(8))).toBe(0);
  });

  it("a pause that shortens the week does not close it early either", () => {
    // Days 0 and 3 are scheduled; the pause covers day 3 on, so only day 0 counts, and kept.
    const twoDays = meditar({
      measure: {
        ...meditar().measure,
        schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 3] } },
      },
    });
    const pause = approvedPause({
      startDay: seasonDay(3),
      end: { kind: "fixed", lastDay: seasonDay(6) },
      decidedOn: seasonDay(3),
    });
    const at = (today: number) => {
      const world = feedWorld({
        today,
        entries: [minutes(twoDays, 0, "30")],
        requests: [pause],
        commitments: [twoDays],
      });
      return memberWeeklySeries({
        season: world.season,
        actualStart: world.actualStart,
        memberId: ANDREA,
        entries: world.entries,
        requests: world.requests,
        today: world.today,
      })[0]?.weeks[0];
    };
    const early = at(7);
    const closed = at(8);
    expect(early).toMatchObject({ final: true, counted: 1, kept: 1 });
    expect(early && isConsistentWeek(early, seasonDay(7))).toBe(false);
    expect(closed && isConsistentWeek(closed, seasonDay(8))).toBe(true);
  });
});

describe("latestFinalWeek", () => {
  it("is null while no week is final", () => {
    expect(latestFinalWeek(seriesOf(3, []), seasonDay(3))).toBeNull();
  });

  it("is the newest week whose commitments are all final (0-based)", () => {
    expect(latestFinalWeek(seriesOf(8, []), seasonDay(8))).toBe(0);
    expect(latestFinalWeek(seriesOf(15, []), seasonDay(15))).toBe(1);
    expect(latestFinalWeek(seriesOf(27, []), seasonDay(27))).toBe(2);
    expect(latestFinalWeek(seriesOf(40, []), seasonDay(40))).toBe(3);
  });

  it("is null for a member with no commitments", () => {
    const world = feedWorld({ today: 40, commitments: [meditar()] });
    const series = memberWeeklySeries({
      season: world.season,
      actualStart: world.actualStart,
      memberId: memberId("member-nobody"),
      entries: [],
      requests: [],
      today: world.today,
    });
    expect(latestFinalWeek(series, world.today)).toBeNull();
  });
});
