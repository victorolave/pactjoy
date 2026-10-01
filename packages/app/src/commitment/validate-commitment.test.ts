import { eq, type QuantityUnit } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { QuantityPrecision } from "./commitment.ts";
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

  describe("quantity precision per unit", () => {
    const schedule = { period: "weeklyTotal" } as const;
    function reach(unit: QuantityUnit, extra: { precision?: "integer" | "decimal" } = {}) {
      return (minimum: string, ideal: string) =>
        validateCommitment({
          weightPercent: 20,
          measure: { unit, direction: "reach", minimum, ideal, schedule, ...extra },
        });
    }

    function precisionOf(result: ReturnType<typeof validateCommitment>) {
      if (!result.ok || result.value.unit === "done")
        throw new Error("expected a quantity measure");
      return result.value.precision;
    }

    it("derives precision from the unit: integer for times, pages and glasses, decimal otherwise", () => {
      for (const unit of ["times", "pages", "glasses"] as const) {
        expect(precisionOf(reach(unit)("1", "2"))).toBe("integer");
      }
      for (const unit of ["minutes", "hours", "km"] as const) {
        expect(precisionOf(reach(unit)("1", "2.5"))).toBe("decimal");
      }
    });

    it("lets a custom unit choose its precision, defaulting to decimal", () => {
      expect(precisionOf(reach("custom")("1", "2.5"))).toBe("decimal");
      expect(precisionOf(reach("custom", { precision: "decimal" })("1", "2.5"))).toBe("decimal");
      expect(precisionOf(reach("custom", { precision: "integer" })("1", "2"))).toBe("integer");
    });

    it("accepts an explicit precision on a built-in unit only when it equals the unit's own", () => {
      expect(precisionOf(reach("times", { precision: "integer" })("1", "2"))).toBe("integer");
      expect(precisionOf(reach("minutes", { precision: "decimal" })("1", "2.5"))).toBe("decimal");
      const notApplicable = { ok: false, error: { kind: "PrecisionNotApplicable" } };
      expect(reach("times", { precision: "decimal" })("1", "2")).toEqual(notApplicable);
      expect(reach("minutes", { precision: "integer" })("1", "2")).toEqual(notApplicable);
    });

    it("rejects a precision that is neither integer nor decimal, on any unit", () => {
      const invalid = { ok: false, error: { kind: "InvalidPrecision" } };
      const bogus = "whole" as unknown as QuantityPrecision;
      expect(reach("custom", { precision: bogus })("1", "2")).toEqual(invalid);
      expect(reach("minutes", { precision: bogus })("1", "2")).toEqual(invalid);
    });

    it("caps thresholds at 9 integer digits, ignoring leading zeros", () => {
      const tooMany = (field: string) => ({
        ok: false,
        error: { kind: "InvalidQuantity", field },
      });
      expect(reach("minutes")("1", "999999999.99").ok).toBe(true);
      expect(reach("minutes")("1", "0000000001").ok).toBe(true);
      expect(reach("minutes")("1", "1000000000")).toEqual(tooMany("ideal"));
      expect(reach("minutes")("1000000000", "1000000000")).toEqual(tooMany("minimum"));
      const limit = (ideal: string, tolerance: string) =>
        validateCommitment({
          weightPercent: 20,
          measure: { unit: "minutes", direction: "limit", ideal, tolerance, schedule },
        });
      expect(limit("1", "1000000000")).toEqual(tooMany("tolerance"));
      expect(limit("1000000000", "1000000000")).toEqual(tooMany("ideal"));
    });

    it("rejects a non-integer minimum or ideal on an integer unit, naming the field", () => {
      const required = (field: string) => ({
        ok: false,
        error: { kind: "IntegerRequired", field },
      });
      expect(reach("pages")("1.5", "3")).toEqual(required("minimum"));
      expect(reach("pages")("1", "3.25")).toEqual(required("ideal"));
      expect(reach("pages")("1", "3.0")).toEqual(required("ideal"));
      expect(reach("custom", { precision: "integer" })("1", "2.5")).toEqual(required("ideal"));
    });

    it("rejects a non-integer tolerance or limit ideal on an integer unit", () => {
      const required = (field: string) => ({
        ok: false,
        error: { kind: "IntegerRequired", field },
      });
      const limit = (ideal: string, tolerance: string) =>
        validateCommitment({
          weightPercent: 20,
          measure: { unit: "glasses", direction: "limit", ideal, tolerance, schedule },
        });
      expect(limit("1.5", "3")).toEqual(required("ideal"));
      expect(limit("1", "3.5")).toEqual(required("tolerance"));
      expect(limit("1", "3").ok).toBe(true);
    });

    it("keeps accepting decimal targets on decimal units", () => {
      expect(reach("km")("1.5", "3.25").ok).toBe(true);
      expect(reach("custom", { precision: "decimal" })("0.5", "2.25").ok).toBe(true);
    });
  });
  describe("frequency (user decision 2026-09-30)", () => {
    const doneWith = (frequency: unknown) =>
      validateCommitment({
        weightPercent: 20,
        measure: { unit: "done", frequency: frequency as never },
      });
    const quantityWith = (frequency: unknown) =>
      validateCommitment({
        weightPercent: 20,
        measure: {
          unit: "minutes",
          direction: "reach",
          minimum: "1",
          ideal: "2",
          schedule: { period: "perSession", frequency: frequency as never },
        },
      });
    const times = (n: number) => ({ kind: "timesPerWeek", times: n });
    const days = (weekdays: number[]) => ({ kind: "specificDays", weekdays });

    for (const [name, run] of [
      ["done", doneWith],
      ["perSession quantity", quantityWith],
    ] as const) {
      describe(name, () => {
        it.each([0, 8, -1, 1.5, Number.NaN])("rejects %s times per week", (n) => {
          expect(run(times(n))).toEqual({ ok: false, error: { kind: "InvalidTimesPerWeek" } });
        });

        it.each([1, 7])("accepts %s times per week", (n) => {
          expect(run(times(n)).ok).toBe(true);
        });

        it("rejects an empty weekday list", () => {
          expect(run(days([]))).toEqual({ ok: false, error: { kind: "NoWeekdays" } });
        });

        it("rejects a repeated weekday", () => {
          expect(run(days([1, 1]))).toEqual({ ok: false, error: { kind: "DuplicateWeekday" } });
        });

        it.each([-1, 7, 1.5])("rejects weekday %s", (d) => {
          expect(run(days([0, d]))).toEqual({ ok: false, error: { kind: "InvalidWeekday" } });
        });

        it("accepts weekdays 0 and 6 and the full week", () => {
          expect(run(days([0, 6])).ok).toBe(true);
          expect(run(days([0, 1, 2, 3, 4, 5, 6])).ok).toBe(true);
        });
      });
    }

    it.each([undefined, null, "1,2", 3, { length: 2 }])(
      "rejects non-array weekdays (%s) without throwing",
      (weekdays) => {
        expect(doneWith({ kind: "specificDays", weekdays })).toEqual({
          ok: false,
          error: { kind: "InvalidWeekday" },
        });
      },
    );

    it("reports an invalid weekday before a duplicate", () => {
      expect(doneWith(days([1, 1, 9]))).toEqual({ ok: false, error: { kind: "InvalidWeekday" } });
    });

    it("does not constrain a weeklyTotal schedule", () => {
      const result = validateCommitment({
        weightPercent: 20,
        measure: {
          unit: "minutes",
          direction: "reach",
          minimum: "1",
          ideal: "2",
          schedule: { period: "weeklyTotal" },
        },
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("custom label invisible characters (user decision 2026-09-30)", () => {
    const withLabel = (customLabel: string) =>
      validateCommitment({
        weightPercent: 20,
        measure: {
          unit: "custom",
          customLabel,
          direction: "reach",
          minimum: "1",
          ideal: "2",
          schedule: { period: "weeklyTotal" },
        },
      });

    it.each([
      ["newline", "a\nb"],
      ["tab", "a\tb"],
      ["US (0x1f)", "a\u001fb"],
      ["DEL", "a\u007fb"],
      ["C1 control", "a\u0085b"],
      ["zero-width space", "a\u200bb"],
      ["zero-width non-joiner", "a\u200cb"],
      ["zero-width joiner", "a\u200db"],
      ["BOM", "a\ufeffb"],
      ["bidi override", "a\u202eb"],
      ["line separator", "a\u2028b"],
      ["paragraph separator", "a\u2029b"],
    ])("rejects a label containing %s", (_name, label) => {
      expect(withLabel(label)).toEqual({
        ok: false,
        error: { kind: "CustomLabelHasInvisibleCharacters" },
      });
    });

    it.each([
      ["empty", ""],
      ["spaces", "   "],
      ["tab-free unicode spaces", "\u00a0\u3000"],
    ])("rejects a blank label (%s)", (_name, label) => {
      expect(withLabel(label)).toEqual({ ok: false, error: { kind: "CustomLabelBlank" } });
    });

    it.each([
      ["high", "a\uD83Db"],
      ["low", "a\uDE00b"],
      ["trailing high", "km\uD83D"],
      ["NUL (unstorable, reported before the invisible-character rule)", "a\u0000b"],
    ])("rejects a label with a lone %s surrogate (storable text)", (_name, label) => {
      expect(withLabel(label)).toEqual({ ok: false, error: { kind: "CustomLabelMalformed" } });
      expect(withLabel("km \u{1F3C3}").ok).toBe(true);
    });

    it("reports malformed text before invisible characters", () => {
      expect(withLabel("a\u0000\uD83D")).toEqual({
        ok: false,
        error: { kind: "CustomLabelMalformed" },
      });
    });

    it("reports an over-long label before malformed text", () => {
      expect(withLabel(`${"a".repeat(20)}\uD83D`)).toEqual({
        ok: false,
        error: { kind: "CustomLabelTooLong" },
      });
    });

    it("reports invisible characters before blankness", () => {
      expect(withLabel("  \n  ")).toEqual({
        ok: false,
        error: { kind: "CustomLabelHasInvisibleCharacters" },
      });
    });

    it("accepts a label with surrounding spaces as long as it has visible text", () => {
      expect(withLabel(" a ").ok).toBe(true);
    });

    describe("zero width joiner (U+200D)", () => {
      it.each([
        ["woman running + km", "\u{1F3C3}\u200D\u2640\uFE0F km"],
        ["family", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"],
        ["rainbow flag", "\u{1F3F3}\uFE0F\u200D\u{1F308}"],
        ["man running, skin tone", "\u{1F3C3}\u{1F3FD}\u200D\u2642\uFE0F"],
      ])("accepts a ZWJ that joins two emoji (%s)", (_name, label) => {
        expect(withLabel(label).ok).toBe(true);
      });

      it.each([
        ["between letters", "a\u200Db"],
        ["alone", "\u200D"],
        ["trailing after text", "km\u200D"],
        ["leading", "\u200D\u{1F3C3}"],
        ["trailing after emoji", "\u{1F3C3}\u200D"],
        ["emoji then letter", "\u{1F3C3}\u200Da"],
        ["two in a row", "\u{1F3C3}\u200D\u200D\u2640"],
      ])("rejects a ZWJ that does not join two emoji (%s)", (_name, label) => {
        expect(withLabel(label)).toEqual({
          ok: false,
          error: { kind: "CustomLabelHasInvisibleCharacters" },
        });
      });

      it("still rejects other format characters next to emoji", () => {
        expect(withLabel("\u{1F3C3}\u200B\u2640").ok).toBe(false);
      });
    });

    it("reports an over-long label before its invisible characters", () => {
      expect(withLabel(`${"a".repeat(20)}\u0000`)).toEqual({
        ok: false,
        error: { kind: "CustomLabelTooLong" },
      });
    });

    it("accepts a plain label with spaces and non-ASCII letters", () => {
      expect(withLabel("vasos de agua ñ").ok).toBe(true);
    });
  });
});
