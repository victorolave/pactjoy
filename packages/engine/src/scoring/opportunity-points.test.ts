import { describe, expect, it } from "vitest";
import { seasonDay } from "../calendar/season-calendar.ts";
import type { Commitment, CommitmentId } from "../commitment/commitment.ts";
import type { Entry } from "../entry/entry.ts";
import { frac, fromInt } from "../fraction/fraction.ts";
import {
  opportunityPoints,
  opportunityValue,
  progressAtValue,
  sumPoints,
} from "./opportunity-points.ts";

describe("sumPoints", () => {
  it("adds exactly, so rounding can happen once afterwards", () => {
    expect(sumPoints([frac(1n, 3n), frac(1n, 3n), frac(1n, 3n)])).toEqual(fromInt(1));
    expect(sumPoints([])).toEqual(fromInt(0));
  });
});

const id = "c1" as CommitmentId;
const reading: Commitment = {
  id,
  weightPercent: 25,
  unit: "minutes",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 5 } },
};
const drawing: Commitment = {
  id,
  weightPercent: 20,
  unit: "done",
  schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [1, 3, 5] } },
};
const coffees: Commitment = {
  id,
  weightPercent: 10,
  unit: "times",
  target: { direction: "limit", ideal: fromInt(2), tolerance: fromInt(4) },
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 7 } },
};

const minutes = (value: number): Entry => ({
  commitmentId: id,
  day: seasonDay(3),
  recordedOn: seasonDay(3),
  kind: "quantity",
  value: fromInt(value),
});

describe("opportunityValue", () => {
  it("is weight x 1000 over the season's active opportunities (design: Leer 250 / 40 = 6.25)", () => {
    expect(opportunityValue(reading, 40)).toEqual(frac(25n, 4n));
  });

  it("is exact when the division does not terminate", () => {
    expect(opportunityValue(drawing, 3)).toEqual(frac(200n, 3n));
  });
});

describe("progressAtValue", () => {
  it("is zero below the minimum and value / ideal from it (reach)", () => {
    expect(progressAtValue(reading, fromInt(5))).toEqual(fromInt(0));
    expect(progressAtValue(reading, fromInt(20))).toEqual(frac(2n, 3n));
    expect(progressAtValue(reading, fromInt(45))).toEqual(fromInt(1));
  });

  it("scores 3 coffees at 75 % and 5 at 0 (limit)", () => {
    expect(progressAtValue(coffees, fromInt(3))).toEqual(frac(3n, 4n));
    expect(progressAtValue(coffees, fromInt(5))).toEqual(fromInt(0));
  });

  it("treats a done commitment as all-or-nothing", () => {
    expect(progressAtValue(drawing, fromInt(1))).toEqual(fromInt(1));
    expect(progressAtValue(drawing, null)).toEqual(fromInt(0));
  });
});

describe("opportunityPoints", () => {
  it("is the opportunity's value times the progress of the entry (20 of 30 min -> 2/3 of 6.25)", () => {
    expect(opportunityPoints(reading, 40, [minutes(20)])).toEqual(frac(25n, 6n));
  });

  it("sums several entries of the same opportunity first (design 22: 25 + 10 min reaches the ideal)", () => {
    expect(opportunityPoints(reading, 40, [minutes(25), minutes(10)])).toEqual(frac(25n, 4n));
  });

  it("is zero with no entries or only a missed one", () => {
    expect(opportunityPoints(reading, 40, [])).toEqual(fromInt(0));
    const missed: Entry = {
      commitmentId: id,
      day: seasonDay(3),
      recordedOn: seasonDay(3),
      kind: "missed",
    };
    expect(opportunityPoints(reading, 40, [missed])).toEqual(fromInt(0));
  });

  it("is zero when the season has no active opportunity", () => {
    expect(opportunityPoints(reading, 0, [minutes(30)])).toEqual(fromInt(0));
  });
});
