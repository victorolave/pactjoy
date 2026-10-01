import { type Frequency, frac, fromInt, type MemberId, parseDecimal } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { habitId } from "../shared/ids.ts";
import {
  buildCommitment,
  commitmentId,
  commitmentsSumToFullWeight,
  type Measure,
  measuresEqual,
} from "./commitment.ts";

function memberIdFor(value: string): MemberId {
  return value as MemberId;
}

describe("commitmentId", () => {
  it("brands a plain string, same pattern as circle.ts's memberId", () => {
    const id = commitmentId("commitment-1");

    expect(id).toBe("commitment-1");
  });
});

describe("buildCommitment", () => {
  it("SS-7: assembles a done commitment, always reach + perSession by construction (engine R3)", () => {
    const commitment = buildCommitment({
      id: commitmentId("commitment-1"),
      memberId: memberIdFor("member-1"),
      habitId: habitId("habit-1"),
      weightPercent: 20,
      privacy: "visible",
      measure: {
        unit: "done",
        schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
      },
    });

    expect(commitment.measure.unit).toBe("done");
    if (commitment.measure.unit === "done") {
      expect(commitment.measure.schedule.period).toBe("perSession");
    }
    expect(commitment.weightPercent).toBe(20);
    expect(commitment.privacy).toBe("visible");
  });

  it("assembles a quantity commitment carrying a parsed target and optional custom label", () => {
    const commitment = buildCommitment({
      id: commitmentId("commitment-2"),
      memberId: memberIdFor("member-1"),
      habitId: habitId("habit-2"),
      weightPercent: 15,
      privacy: "private",
      measure: {
        unit: "km",
        customLabel: null,
        precision: "decimal",
        target: { direction: "reach", minimum: fromInt(3), ideal: fromInt(5) },
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(commitment.measure.unit).toBe("km");
    expect(commitment.privacy).toBe("private");
  });
});

function commitmentWithWeight(weightPercent: number) {
  return buildCommitment({
    id: commitmentId(`commitment-${weightPercent}`),
    memberId: memberIdFor("member-1"),
    habitId: habitId("habit-1"),
    weightPercent,
    privacy: "visible",
    measure: {
      unit: "done",
      schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
    },
  });
}

describe("commitmentsSumToFullWeight", () => {
  it("B5: true when a member's commitment weights sum to exactly 100", () => {
    const commitments = [commitmentWithWeight(60), commitmentWithWeight(40)];

    expect(commitmentsSumToFullWeight(commitments)).toBe(true);
  });

  it("B5: false when the weights sum to less than 100", () => {
    const commitments = [commitmentWithWeight(60), commitmentWithWeight(30)];

    expect(commitmentsSumToFullWeight(commitments)).toBe(false);
  });

  it("B5: false for a member with zero commitments (sum is 0, not 100)", () => {
    expect(commitmentsSumToFullWeight([])).toBe(false);
  });
});

function done(frequency: Frequency): Measure {
  return { unit: "done", schedule: { period: "perSession", frequency } };
}

function quantity(overrides: Partial<Extract<Measure, { target: unknown }>> = {}): Measure {
  return {
    unit: "minutes",
    customLabel: null,
    precision: "decimal",
    target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
    schedule: { period: "weeklyTotal" },
    ...overrides,
  };
}

describe("measuresEqual (SS-13, PI-S13)", () => {
  it("is true for identical done measures and for identical quantity measures", () => {
    expect(
      measuresEqual(
        done({ kind: "timesPerWeek", times: 3 }),
        done({ kind: "timesPerWeek", times: 3 }),
      ),
    ).toBe(true);
    expect(measuresEqual(quantity(), quantity())).toBe(true);
  });

  it("is false across units: done vs quantity, and minutes vs km", () => {
    expect(measuresEqual(done({ kind: "timesPerWeek", times: 3 }), quantity())).toBe(false);
    expect(measuresEqual(quantity(), quantity({ unit: "km" }))).toBe(false);
  });

  it("is false when the done frequency differs (times, or kind)", () => {
    const three = done({ kind: "timesPerWeek", times: 3 });
    expect(measuresEqual(three, done({ kind: "timesPerWeek", times: 4 }))).toBe(false);
    expect(measuresEqual(three, done({ kind: "specificDays", weekdays: [1, 3, 5] }))).toBe(false);
  });

  it("compares specificDays weekdays as a SET: a reordering is equal, a different day is not", () => {
    const a = done({ kind: "specificDays", weekdays: [1, 3, 5] });
    expect(measuresEqual(a, done({ kind: "specificDays", weekdays: [5, 1, 3] }))).toBe(true);
    expect(measuresEqual(a, done({ kind: "specificDays", weekdays: [1, 3, 6] }))).toBe(false);
    expect(measuresEqual(a, done({ kind: "specificDays", weekdays: [1, 3] }))).toBe(false);
  });

  it("is false when custom label, precision or period differ", () => {
    expect(
      measuresEqual(
        quantity({ unit: "custom", customLabel: "a" }),
        quantity({ unit: "custom", customLabel: "b" }),
      ),
    ).toBe(false);
    expect(
      measuresEqual(quantity({ precision: "integer" }), quantity({ precision: "decimal" })),
    ).toBe(false);
    expect(
      measuresEqual(
        quantity(),
        quantity({
          schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 2 } },
        }),
      ),
    ).toBe(false);
  });

  it("is false when the schedule frequency differs on a quantity measure", () => {
    const sessions = (times: number) =>
      quantity({ schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times } } });
    expect(measuresEqual(sessions(2), sessions(2))).toBe(true);
    expect(measuresEqual(sessions(2), sessions(3))).toBe(false);
  });

  it("reach: equal fractions built differently are equal; a different threshold is not", () => {
    const viaDecimal = quantity({
      target: { direction: "reach", minimum: parseDecimal("10.0"), ideal: frac(60n, 2n) },
    });
    expect(measuresEqual(quantity(), viaDecimal)).toBe(true);
    for (const target of [
      { direction: "reach", minimum: fromInt(11), ideal: fromInt(30) },
      { direction: "reach", minimum: fromInt(10), ideal: fromInt(31) },
    ] as const) {
      expect(measuresEqual(quantity(), quantity({ target }))).toBe(false);
    }
  });

  it("limit: compares ideal and tolerance, and a direction change is a difference", () => {
    const limit = (ideal: number, tolerance: number) =>
      quantity({
        target: { direction: "limit", ideal: fromInt(ideal), tolerance: fromInt(tolerance) },
      });
    expect(measuresEqual(limit(2, 4), limit(2, 4))).toBe(true);
    expect(measuresEqual(limit(2, 4), limit(3, 4))).toBe(false);
    expect(measuresEqual(limit(2, 4), limit(2, 5))).toBe(false);
    expect(measuresEqual(limit(10, 30), quantity())).toBe(false);
  });
});
