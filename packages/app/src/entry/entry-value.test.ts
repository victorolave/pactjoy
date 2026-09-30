import { eq, fromInt, parseDecimal } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import { validateEntryValue } from "./entry-value.ts";

const DAILY_DONE: Measure = {
  unit: "done",
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};
const DONE_TIMES_PER_WEEK: Measure = {
  unit: "done",
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
};
const REACH_DAY_BOUND: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 2, 4] } },
};
const REACH_TIMES_PER_WEEK: Measure = {
  ...REACH_DAY_BOUND,
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
};
const REACH_WEEKLY_TOTAL: Measure = { ...REACH_DAY_BOUND, schedule: { period: "weeklyTotal" } };
const LIMIT_DAY_BOUND: Measure = {
  unit: "times",
  customLabel: null,
  precision: "integer",
  target: { direction: "limit", ideal: fromInt(2), tolerance: fromInt(4) },
  schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 1, 2] } },
};

function quantity(measure: Measure, value: string) {
  return validateEntryValue(measure, { kind: "quantity", value });
}

describe("validateEntryValue (A8 corrected, B10)", () => {
  it("accepts done on a done commitment and missed on a day-bound reach one (ER-5)", () => {
    expect(validateEntryValue(DAILY_DONE, { kind: "done" })).toEqual({
      ok: true,
      value: { kind: "done" },
    });
    expect(validateEntryValue(DAILY_DONE, { kind: "missed" }).ok).toBe(true);
    expect(validateEntryValue(REACH_DAY_BOUND, { kind: "missed" }).ok).toBe(true);
  });

  it("rejects missed on a limit commitment (ER-6)", () => {
    expect(validateEntryValue(LIMIT_DAY_BOUND, { kind: "missed" })).toEqual({
      ok: false,
      error: { kind: "MissedNotAllowed", reason: "limitDirection" },
    });
  });

  it("rejects missed on timesPerWeek and weeklyTotal commitments (ER-7)", () => {
    for (const measure of [DONE_TIMES_PER_WEEK, REACH_TIMES_PER_WEEK, REACH_WEEKLY_TOTAL]) {
      expect(validateEntryValue(measure, { kind: "missed" })).toEqual({
        ok: false,
        error: { kind: "MissedNotAllowed", reason: "weekBound" },
      });
    }
  });

  it("rejects a value kind that does not fit the unit", () => {
    const mismatch = { ok: false, error: { kind: "ValueKindMismatch" } };
    expect(quantity(DAILY_DONE, "1")).toEqual(mismatch);
    expect(validateEntryValue(REACH_DAY_BOUND, { kind: "done" })).toEqual(mismatch);
    expect(validateEntryValue(LIMIT_DAY_BOUND, { kind: "done" })).toEqual(mismatch);
  });

  it("stores a quantity above the ideal as entered (ER-17)", () => {
    const result = quantity(REACH_DAY_BOUND, "60");
    expect(
      result.ok && result.value.kind === "quantity" && eq(result.value.value, fromInt(60)),
    ).toBe(true);
  });

  it("allows an explicit 0 on reach (B10) and on limit (ER-20)", () => {
    for (const measure of [REACH_DAY_BOUND, REACH_WEEKLY_TOTAL, LIMIT_DAY_BOUND]) {
      const result = quantity(measure, "0");
      expect(
        result.ok && result.value.kind === "quantity" && eq(result.value.value, fromInt(0)),
      ).toBe(true);
    }
  });

  it("parses up to 2 decimals exactly, never through a float", () => {
    const result = quantity(REACH_DAY_BOUND, "7.25");
    expect(
      result.ok && result.value.kind === "quantity" && eq(result.value.value, parseDecimal("7.25")),
    ).toBe(true);
  });

  it("rejects negative, over-precise and non-numeric quantities", () => {
    const invalid = (reason: string) => ({ ok: false, error: { kind: "InvalidQuantity", reason } });
    expect(quantity(LIMIT_DAY_BOUND, "-1")).toEqual(invalid("negative"));
    expect(quantity(REACH_DAY_BOUND, "1.234")).toEqual(invalid("tooManyDecimals"));
    expect(quantity(REACH_DAY_BOUND, "abc")).toEqual(invalid("notANumber"));
    expect(quantity(REACH_DAY_BOUND, "")).toEqual(invalid("notANumber"));
    expect(quantity(REACH_DAY_BOUND, "1e3")).toEqual(invalid("notANumber"));
  });

  it("follows the commitment's precision: integer-only takes whole numbers, decimal takes up to 2 decimals", () => {
    const integerOnly = { ok: false, error: { kind: "InvalidQuantity", reason: "integerOnly" } };
    // The precision field decides, for any unit, custom included.
    for (const unit of ["times", "custom"] as const) {
      const measure = { ...LIMIT_DAY_BOUND, unit, precision: "integer" } as Measure;
      expect(quantity(measure, "1.5")).toEqual(integerOnly);
      expect(quantity(measure, "2.0")).toEqual(integerOnly);
      expect(quantity(measure, "2").ok).toBe(true);
      expect(quantity(measure, "0").ok).toBe(true);
    }
    for (const unit of ["minutes", "custom"] as const) {
      const measure = { ...REACH_DAY_BOUND, unit, precision: "decimal" } as Measure;
      expect(quantity(measure, "1.25").ok).toBe(true);
      expect(quantity(measure, "1.255")).toEqual({
        ok: false,
        error: { kind: "InvalidQuantity", reason: "tooManyDecimals" },
      });
    }
  });

  it("ignores leading zeros when capping the digits", () => {
    expect(quantity(REACH_DAY_BOUND, "0000000000001").ok).toBe(true);
    expect(quantity(REACH_DAY_BOUND, "000000000.50").ok).toBe(true);
    expect(quantity(REACH_DAY_BOUND, "0001000000000")).toEqual({
      ok: false,
      error: { kind: "InvalidQuantity", reason: "tooManyDigits" },
    });
  });

  it("caps a quantity at 9 integer digits", () => {
    expect(quantity(REACH_DAY_BOUND, "999999999").ok).toBe(true);
    expect(quantity(REACH_DAY_BOUND, "999999999.99").ok).toBe(true);
    const tooBig = { ok: false, error: { kind: "InvalidQuantity", reason: "tooManyDigits" } };
    expect(quantity(REACH_DAY_BOUND, "1000000000")).toEqual(tooBig);
    expect(quantity(LIMIT_DAY_BOUND, "1000000000")).toEqual(tooBig);
  });
});
