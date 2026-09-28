import { eq } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { validateCommitment } from "./validate-commitment.ts";

describe("validateCommitment", () => {
  it("SS-7: a done measure is always reach + perSession, accepted with no threshold checks", () => {
    const result = validateCommitment({
      weightPercent: 20,
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unit).toBe("done");
    if (result.value.unit === "done") {
      expect(result.value.schedule.period).toBe("perSession");
      expect(result.value.schedule.frequency).toEqual({ kind: "timesPerWeek", times: 3 });
    }
  });

  it("SS-8: reach minimum equal to ideal is accepted", () => {
    const result = validateCommitment({
      weightPercent: 20,
      measure: {
        unit: "minutes",
        direction: "reach",
        minimum: "30",
        ideal: "30",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(result.ok).toBe(true);
  });

  it("SS-9: reach minimum of zero is rejected", () => {
    const result = validateCommitment({
      weightPercent: 20,
      measure: {
        unit: "minutes",
        direction: "reach",
        minimum: "0",
        ideal: "30",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(result).toEqual({ ok: false, error: { kind: "MinimumNotPositive" } });
  });

  it("rejects reach minimum greater than ideal", () => {
    const result = validateCommitment({
      weightPercent: 20,
      measure: {
        unit: "minutes",
        direction: "reach",
        minimum: "40",
        ideal: "30",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(result).toEqual({ ok: false, error: { kind: "MinimumExceedsIdeal" } });
  });

  it("SS-10: more than 2 decimals is rejected", () => {
    const result = validateCommitment({
      weightPercent: 20,
      measure: {
        unit: "km",
        direction: "reach",
        minimum: "1",
        ideal: "1.567",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidQuantity", field: "ideal" } });
  });

  it("accepts exactly 2 decimals", () => {
    const result = validateCommitment({
      weightPercent: 20,
      measure: {
        unit: "km",
        direction: "reach",
        minimum: "1.25",
        ideal: "5.50",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a negative quantity (the 'ideal >= 0' invariant is guaranteed by this regex, not re-checked)", () => {
    const result = validateCommitment({
      weightPercent: 20,
      measure: {
        unit: "km",
        direction: "reach",
        minimum: "-1",
        ideal: "5",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidQuantity", field: "minimum" } });
  });

  it("D10: '1.50' and '1.5' parse to the exact same Fraction (exact rational precision, never float)", () => {
    const withTrailingZero = validateCommitment({
      weightPercent: 20,
      measure: {
        unit: "km",
        direction: "reach",
        minimum: "1.50",
        ideal: "5",
        schedule: { period: "weeklyTotal" },
      },
    });
    const withoutTrailingZero = validateCommitment({
      weightPercent: 20,
      measure: {
        unit: "km",
        direction: "reach",
        minimum: "1.5",
        ideal: "5",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(withTrailingZero.ok).toBe(true);
    expect(withoutTrailingZero.ok).toBe(true);
    if (!withTrailingZero.ok || !withoutTrailingZero.ok) return;
    const a = withTrailingZero.value;
    const b = withoutTrailingZero.value;
    if (a.unit === "done" || b.unit === "done") return;
    if (a.target.direction !== "reach" || b.target.direction !== "reach") return;
    expect(eq(a.target.minimum, b.target.minimum)).toBe(true);
  });

  it("SS-11: a custom unit label of 21 characters is rejected", () => {
    const result = validateCommitment({
      weightPercent: 20,
      measure: {
        unit: "custom",
        customLabel: "a".repeat(21),
        direction: "reach",
        minimum: "1",
        ideal: "2",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(result).toEqual({ ok: false, error: { kind: "CustomLabelTooLong" } });
  });

  it("accepts a custom unit label of exactly 20 characters", () => {
    const result = validateCommitment({
      weightPercent: 20,
      measure: {
        unit: "custom",
        customLabel: "a".repeat(20),
        direction: "reach",
        minimum: "1",
        ideal: "2",
        schedule: { period: "weeklyTotal" },
      },
    });

    expect(result.ok).toBe(true);
  });

  it("SS-12: a weight not a multiple of 5 is rejected", () => {
    const result = validateCommitment({
      weightPercent: 7,
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidWeight" } });
  });

  it("rejects a weight below 5 or above 100", () => {
    const tooLow = validateCommitment({
      weightPercent: 0,
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
    });
    const tooHigh = validateCommitment({
      weightPercent: 105,
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
    });

    expect(tooLow).toEqual({ ok: false, error: { kind: "InvalidWeight" } });
    expect(tooHigh).toEqual({ ok: false, error: { kind: "InvalidWeight" } });
  });

  describe("limit direction", () => {
    it("accepts ideal equal to tolerance", () => {
      const result = validateCommitment({
        weightPercent: 15,
        measure: {
          unit: "glasses",
          direction: "limit",
          ideal: "2",
          tolerance: "2",
          schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 7 } },
        },
      });

      expect(result.ok).toBe(true);
    });

    it("accepts an ideal of exactly zero", () => {
      const result = validateCommitment({
        weightPercent: 15,
        measure: {
          unit: "glasses",
          direction: "limit",
          ideal: "0",
          tolerance: "1",
          schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 7 } },
        },
      });

      expect(result.ok).toBe(true);
    });

    it("rejects an ideal greater than tolerance", () => {
      const result = validateCommitment({
        weightPercent: 15,
        measure: {
          unit: "glasses",
          direction: "limit",
          ideal: "3",
          tolerance: "2",
          schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 7 } },
        },
      });

      expect(result).toEqual({ ok: false, error: { kind: "IdealExceedsTolerance" } });
    });
  });
});
