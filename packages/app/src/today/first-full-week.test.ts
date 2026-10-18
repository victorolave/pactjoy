import { type Commitment, type Entry, fromInt, type ScoreInput, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { commitmentId } from "../commitment/commitment.ts";
import { givenReviewWorld, logMinutes } from "../review/review-fixtures.ts";
import { firstFullWeek } from "./first-full-week.ts";
import { today } from "./today.query.ts";

const ID = commitmentId("reading");
const daily: Commitment = {
  id: ID,
  weightPercent: 100,
  unit: "minutes",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};
const entries = (days: readonly number[], id = ID): Entry[] =>
  days.map((day) => ({
    commitmentId: id,
    day: seasonDay(day),
    recordedOn: seasonDay(day),
    kind: "quantity",
    value: fromInt(10),
  }));
const input = (extra: Partial<ScoreInput> = {}): ScoreInput => ({
  season: { lengthWeeks: 4, startWeekday: 0 },
  commitments: [daily],
  entries: entries([0, 1, 2, 3, 4, 5, 6]),
  pauses: [],
  today: seasonDay(8),
  ...extra,
});
const pause = (lastDay: number, pending = false): ScoreInput["pauses"][number] => ({
  commitmentId: ID,
  requestedOn: seasonDay(0),
  startDay: seasonDay(0),
  end: { kind: "fixed", lastDay: seasonDay(lastDay) },
  decision: pending
    ? { kind: "pending" }
    : { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
});

describe("first full week (owner definition A)", () => {
  it("accepts minimum-only fulfillment, not ideal completion", () => {
    expect(firstFullWeek(input())).toBe(0);
  });
  it.each([0, 6, 7])("does not celebrate on day %i before week grace expires", (day) => {
    expect(firstFullWeek(input({ today: seasonDay(day) }))).toBeNull();
  });
  it("waits for the whole week even when the only scheduled opportunity is already final", () => {
    const sparse: Commitment = {
      ...daily,
      schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0] } },
    };
    expect(
      firstFullWeek(input({ commitments: [sparse], entries: entries([0]), today: seasonDay(3) })),
    ).toBeNull();
  });
  it("requires every commitment, not rounded consistency or a single consistent habit", () => {
    const other = commitmentId("other");
    expect(
      firstFullWeek(
        input({
          commitments: [
            { ...daily, weightPercent: 50 },
            { ...daily, id: other, weightPercent: 50 },
          ],
        }),
      ),
    ).toBeNull();
  });
  it("finds the earliest success even when week one was hard", () => {
    expect(
      firstFullWeek(
        input({
          entries: entries([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
          today: seasonDay(22),
        }),
      ),
    ).toBe(1);
  });
  it("excludes paused opportunities but never celebrates an empty or fully paused week", () => {
    expect(firstFullWeek(input({ pauses: [pause(2)], entries: entries([3, 4, 5, 6]) }))).toBe(0);
    expect(firstFullWeek(input({ pauses: [pause(6)], entries: [] }))).toBeNull();
    expect(firstFullWeek(input({ commitments: [], entries: [] }))).toBeNull();
  });
  it("does not declare a week final while an overlapping pause is undecided", () => {
    expect(
      firstFullWeek(input({ pauses: [pause(2, true)], entries: entries([3, 4, 5, 6]) })),
    ).toBeNull();
  });
  it.each(["weeklyTotal", "timesPerWeek"])("uses the engine for %s opportunities", (kind) => {
    const schedule =
      kind === "weeklyTotal"
        ? { period: "weeklyTotal" as const }
        : { period: "perSession" as const, frequency: { kind: "timesPerWeek" as const, times: 2 } };
    expect(
      firstFullWeek(input({ commitments: [{ ...daily, schedule }], entries: entries([0, 1]) })),
    ).toBe(0);
  });
  it("limit requires a registration within tolerance, never interpreting absence as zero", () => {
    const limit: Commitment = {
      ...daily,
      schedule: { period: "weeklyTotal" },
      target: { direction: "limit", ideal: fromInt(0), tolerance: fromInt(10) },
    };
    expect(firstFullWeek(input({ commitments: [limit], entries: [] }))).toBeNull();
    expect(firstFullWeek(input({ commitments: [limit], entries: entries([0]) }))).toBe(0);
    expect(firstFullWeek(input({ commitments: [limit], entries: entries([0, 1]) }))).toBeNull();
  });
  it("Today derives the viewer's milestone from its own snapshot, ignoring peer misses", async () => {
    const world = await givenReviewWorld();
    for (let day = 0; day < 7; day++) await logMinutes(world, "meditar", day, "10");
    await logMinutes(world, "leer", 0, "10");
    const own = await today(world.at(9), world.andrea);
    expect(own).toMatchObject({ state: "active", firstFullWeek: 0 });
    expect(await today(world.at(9), world.victor)).toMatchObject({ firstFullWeek: null });
  });
});
