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
    expect(week && isConsistentWeek(week)).toBe(true);
  });

  it("is not consistent with 6 of 7", () => {
    const series = seriesOf(8, some(0, [0, 1, 2, 3, 4, 5]));
    const week = series.find((s) => s.commitmentId === MEDITAR)?.weeks[0];
    expect(week).toMatchObject({ counted: 7, kept: 6 });
    expect(week && isConsistentWeek(week)).toBe(false);
  });

  it("is not consistent until the week is final (grace period over)", () => {
    // Week 0 ends on day 6; its grace day is day 7, so it is only final from day 8.
    const week = seriesOf(7, allWeek(0)).find((s) => s.commitmentId === MEDITAR)?.weeks[0];
    expect(week?.final).toBe(false);
    expect(week && isConsistentWeek(week)).toBe(false);
  });

  it("a week with nothing counted (fully paused) is not consistent", () => {
    const pause = approvedPause({
      startDay: seasonDay(0),
      end: { kind: "fixed", lastDay: seasonDay(6) },
      decidedOn: seasonDay(0),
    });
    const week = seriesOf(8, [], [pause]).find((s) => s.commitmentId === MEDITAR)?.weeks[0];
    expect(week).toMatchObject({ counted: 0, final: true });
    expect(week && isConsistentWeek(week)).toBe(false);
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
    expect(week && isConsistentWeek(week)).toBe(true);
  });
});

describe("hard week (pooled over the member's commitments, kept below half of counted)", () => {
  it("2 * kept < counted is hard", () => {
    // meditar 2 of 7 + leer 1 of 1 = 3 of 8.
    const series = seriesOf(8, [...some(0, [0, 1]), reading(0)]);
    const pooled = pooledWeek(series, 0);
    expect(pooled).toMatchObject({ counted: 8, kept: 3, final: true });
    expect(isHardWeek(pooled)).toBe(true);
  });

  it("2 * kept === counted is NOT hard (exactly half)", () => {
    // meditar 3 of 7 + leer 1 of 1 = 4 of 8.
    const pooled = pooledWeek(seriesOf(8, [...some(0, [0, 1, 2]), reading(0)]), 0);
    expect(pooled).toMatchObject({ counted: 8, kept: 4 });
    expect(isHardWeek(pooled)).toBe(false);
  });

  it("a week that is not final is never hard", () => {
    const pooled = pooledWeek(seriesOf(7, []), 0);
    expect(pooled.final).toBe(false);
    expect(isHardWeek(pooled)).toBe(false);
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
    expect(isHardWeek(pooled)).toBe(false);
  });
});

describe("latestFinalWeek", () => {
  it("is null while no week is final", () => {
    expect(latestFinalWeek(seriesOf(3, []))).toBeNull();
  });

  it("is the newest week whose commitments are all final (0-based)", () => {
    expect(latestFinalWeek(seriesOf(8, []))).toBe(0);
    expect(latestFinalWeek(seriesOf(15, []))).toBe(1);
    expect(latestFinalWeek(seriesOf(27, []))).toBe(2);
    expect(latestFinalWeek(seriesOf(40, []))).toBe(3);
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
    expect(latestFinalWeek(series)).toBeNull();
  });
});
