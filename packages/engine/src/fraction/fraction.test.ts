import { describe, expect, it } from "vitest";
import {
  add,
  clamp01,
  compare,
  div,
  eq,
  frac,
  fromInt,
  gt,
  gte,
  isZero,
  lt,
  lte,
  max,
  mean,
  min,
  mul,
  parseDecimal,
  roundHalfUp,
  sub,
  sum,
} from "./fraction.ts";

describe("frac", () => {
  it("reduces a fraction to lowest terms", () => {
    expect(frac(4n, 6n)).toEqual({ num: 2n, den: 3n });
  });

  it("throws RangeError when the denominator is zero", () => {
    expect(() => frac(1n, 0n)).toThrow(RangeError);
  });

  it("normalizes the sign onto the numerator when the denominator is negative", () => {
    expect(frac(3n, -4n)).toEqual({ num: -3n, den: 4n });
  });

  it("keeps a negative numerator with a positive denominator as-is (already normalized)", () => {
    expect(frac(-3n, 4n)).toEqual({ num: -3n, den: 4n });
  });

  it("collapses zero to the canonical 0/1 regardless of the input denominator", () => {
    expect(frac(0n, 7n)).toEqual({ num: 0n, den: 1n });
  });

  it("defaults the denominator to 1 when omitted, for a whole-number fraction", () => {
    expect(frac(5n)).toEqual({ num: 5n, den: 1n });
  });

  it("reduces a fraction with both numerator and denominator negative to the exact positive 2/3", () => {
    expect(frac(-4n, -6n)).toEqual({ num: 2n, den: 3n });
  });

  it("collapses zero over a negative denominator to the canonical 0/1", () => {
    expect(frac(0n, -7n)).toEqual({ num: 0n, den: 1n });
  });
});

describe("fromInt", () => {
  it("converts a safe integer to a whole-number Fraction", () => {
    expect(fromInt(42)).toEqual({ num: 42n, den: 1n });
  });

  it("throws RangeError for a non-integer number", () => {
    expect(() => fromInt(1.5)).toThrow(RangeError);
  });

  it("throws RangeError for a number beyond Number.MAX_SAFE_INTEGER", () => {
    expect(() => fromInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe("arithmetic", () => {
  it("adds 1/3 and 1/6 to the exact 1/2", () => {
    expect(add(frac(1n, 3n), frac(1n, 6n))).toEqual({ num: 1n, den: 2n });
  });

  it("subtracts 1/3 from 3/4 to the exact 5/12", () => {
    expect(sub(frac(3n, 4n), frac(1n, 3n))).toEqual({ num: 5n, den: 12n });
  });

  it("multiplies 2/3 by 3/4 to the exact 1/2", () => {
    expect(mul(frac(2n, 3n), frac(3n, 4n))).toEqual({ num: 1n, den: 2n });
  });

  it("divides 1/2 by 1/3 to the exact 3/2", () => {
    expect(div(frac(1n, 2n), frac(1n, 3n))).toEqual({ num: 3n, den: 2n });
  });

  it("throws RangeError when dividing by a zero fraction", () => {
    expect(() => div(frac(1n, 2n), frac(0n))).toThrow(RangeError);
  });

  it("orders 1/3 as less than 1/2 via compare", () => {
    expect(compare(frac(1n, 3n), frac(1n, 2n))).toBe(-1);
    expect(compare(frac(1n, 2n), frac(1n, 3n))).toBe(1);
    expect(compare(frac(1n, 2n), frac(2n, 4n))).toBe(0);
  });

  it("reports eq/lt/lte/gt/gte consistently for 1/3 vs 1/2", () => {
    expect(eq(frac(1n, 2n), frac(2n, 4n))).toBe(true);
    expect(eq(frac(1n, 3n), frac(1n, 2n))).toBe(false);
    expect(lt(frac(1n, 3n), frac(1n, 2n))).toBe(true);
    expect(lt(frac(1n, 2n), frac(1n, 3n))).toBe(false);
    expect(lte(frac(1n, 2n), frac(2n, 4n))).toBe(true);
    expect(gt(frac(1n, 2n), frac(1n, 3n))).toBe(true);
    expect(gte(frac(1n, 2n), frac(2n, 4n))).toBe(true);
  });

  it("picks the smaller/larger of two fractions with min/max", () => {
    expect(min(frac(1n, 3n), frac(1n, 2n))).toEqual({ num: 1n, den: 3n });
    expect(max(frac(1n, 3n), frac(1n, 2n))).toEqual({ num: 1n, den: 2n });
  });
});

describe("arithmetic with negative operands", () => {
  it("adds two negative fractions to the exact -1/2", () => {
    expect(add(frac(-1n, 3n), frac(-1n, 6n))).toEqual({ num: -1n, den: 2n });
  });

  it("adds a negative and a positive fraction (mixed signs) to the exact -1/6", () => {
    expect(add(frac(-1n, 3n), frac(1n, 6n))).toEqual({ num: -1n, den: 6n });
  });

  it("subtracts a positive fraction from a negative one to the exact -1/2", () => {
    expect(sub(frac(-1n, 3n), frac(1n, 6n))).toEqual({ num: -1n, den: 2n });
  });

  it("multiplies two negative fractions to the exact positive 1/2", () => {
    expect(mul(frac(-2n, 3n), frac(-3n, 4n))).toEqual({ num: 1n, den: 2n });
  });

  it("multiplies a negative and a positive fraction (mixed signs) to the exact -1/2", () => {
    expect(mul(frac(-2n, 3n), frac(3n, 4n))).toEqual({ num: -1n, den: 2n });
  });

  it("divides two negative fractions to the exact positive 3/2", () => {
    expect(div(frac(-1n, 2n), frac(-1n, 3n))).toEqual({ num: 3n, den: 2n });
  });

  it("divides a negative fraction by a positive one (mixed signs) to the exact -3/2", () => {
    expect(div(frac(-1n, 2n), frac(1n, 3n))).toEqual({ num: -3n, den: 2n });
  });

  it("orders two negative fractions correctly via compare (-1/2 is less than -1/3)", () => {
    expect(compare(frac(-1n, 2n), frac(-1n, 3n))).toBe(-1);
    expect(compare(frac(-1n, 3n), frac(-1n, 2n))).toBe(1);
  });

  it("orders a negative fraction as less than a positive one (mixed signs) via compare", () => {
    expect(compare(frac(-1n, 2n), frac(1n, 3n))).toBe(-1);
    expect(compare(frac(1n, 3n), frac(-1n, 2n))).toBe(1);
  });

  it("picks the more negative of two negative fractions with min, the less negative with max", () => {
    expect(min(frac(-1n, 2n), frac(-1n, 3n))).toEqual({ num: -1n, den: 2n });
    expect(max(frac(-1n, 2n), frac(-1n, 3n))).toEqual({ num: -1n, den: 3n });
  });

  it("picks the negative fraction as min and the positive one as max (mixed signs)", () => {
    expect(min(frac(-1n, 2n), frac(1n, 3n))).toEqual({ num: -1n, den: 2n });
    expect(max(frac(-1n, 2n), frac(1n, 3n))).toEqual({ num: 1n, den: 3n });
  });
});

describe("sum and mean", () => {
  it("sums 1/3, 1/3 and 1/3 to the exact whole 1", () => {
    expect(sum([frac(1n, 3n), frac(1n, 3n), frac(1n, 3n)])).toEqual({ num: 1n, den: 1n });
  });

  it("returns the canonical zero for an empty list", () => {
    expect(sum([])).toEqual({ num: 0n, den: 1n });
  });

  it("averages 1/3 and 2/3 to the exact 1/2", () => {
    expect(mean([frac(1n, 3n), frac(2n, 3n)])).toEqual({ num: 1n, den: 2n });
  });

  it("throws RangeError for an empty list when emptyThrows is true (default)", () => {
    expect(() => mean([])).toThrow(RangeError);
  });

  it("returns the canonical zero for an empty list when emptyThrows is false", () => {
    expect(mean([], false)).toEqual({ num: 0n, den: 1n });
  });
});

describe("clamp01 and isZero", () => {
  it("leaves a fraction already within [0,1] unchanged", () => {
    expect(clamp01(frac(1n, 3n))).toEqual({ num: 1n, den: 3n });
  });

  it("clamps a fraction above 1 down to the exact 1", () => {
    expect(clamp01(frac(4n, 3n))).toEqual({ num: 1n, den: 1n });
  });

  it("clamps a negative fraction up to the exact 0", () => {
    expect(clamp01(frac(-1n, 3n))).toEqual({ num: 0n, den: 1n });
  });

  it("reports isZero true only for the canonical zero", () => {
    expect(isZero(frac(0n, 5n))).toBe(true);
    expect(isZero(frac(1n, 5n))).toBe(false);
  });
});

describe("roundHalfUp", () => {
  it("rounds the exact .5 boundary up to 1", () => {
    expect(roundHalfUp(frac(1n, 2n))).toBe(1n);
  });

  it("rounds a fraction below .5 down", () => {
    expect(roundHalfUp(frac(1n, 3n))).toBe(0n);
  });

  it("rounds a fraction above .5 up", () => {
    expect(roundHalfUp(frac(2n, 3n))).toBe(1n);
  });

  it("rounds an exact whole number to itself", () => {
    expect(roundHalfUp(frac(4n, 1n))).toBe(4n);
  });

  it("rounds a larger .5 boundary (3/2) up to 2", () => {
    expect(roundHalfUp(frac(3n, 2n))).toBe(2n);
  });

  it("rounds the negative .5 boundary toward positive infinity, to 0", () => {
    // round-half-up rounds .5 toward +infinity, not away from zero: D6/D10
    // only ever round non-negative quantities, so this negative case is this
    // module's own convention, not something D6/D10 specify.
    // floor(-0.5 + 0.5) = floor(0) = 0.
    expect(roundHalfUp(frac(-1n, 2n))).toBe(0n);
  });

  it("rounds a non-boundary negative fraction (-3/2) to -1", () => {
    expect(roundHalfUp(frac(-3n, 2n))).toBe(-1n);
  });
});

describe("parseDecimal", () => {
  it('parses "3.5" to the exact 7/2', () => {
    expect(parseDecimal("3.5")).toEqual({ num: 7n, den: 2n });
  });

  it('parses a whole-number string "4" to the exact 4/1', () => {
    expect(parseDecimal("4")).toEqual({ num: 4n, den: 1n });
  });

  it('parses a negative decimal "-1.25" to the exact -5/4', () => {
    expect(parseDecimal("-1.25")).toEqual({ num: -5n, den: 4n });
  });

  it("rejects exponent notation", () => {
    expect(() => parseDecimal("1e3")).toThrow(RangeError);
  });

  it('rejects the literal string "NaN"', () => {
    expect(() => parseDecimal("NaN")).toThrow(RangeError);
  });

  it("rejects an empty string", () => {
    expect(() => parseDecimal("")).toThrow(RangeError);
  });

  it("rejects a string with multiple decimal points", () => {
    expect(() => parseDecimal("1.2.3")).toThrow(RangeError);
  });

  it('rejects a trailing decimal point with no digits after it ("1.")', () => {
    expect(() => parseDecimal("1.")).toThrow(RangeError);
  });

  it('rejects a leading decimal point with no digits before it (".5")', () => {
    expect(() => parseDecimal(".5")).toThrow(RangeError);
  });

  it('rejects an explicit unary plus sign ("+1")', () => {
    expect(() => parseDecimal("+1")).toThrow(RangeError);
  });

  it('rejects a leading space (" 1")', () => {
    expect(() => parseDecimal(" 1")).toThrow(RangeError);
  });

  it('rejects a trailing space ("1 ")', () => {
    expect(() => parseDecimal("1 ")).toThrow(RangeError);
  });

  it('parses "-0" to the canonical exact 0/1, not a negative zero', () => {
    expect(parseDecimal("-0")).toEqual({ num: 0n, den: 1n });
  });

  it('parses a zero-padded whole number "007" to the exact 7/1', () => {
    expect(parseDecimal("007")).toEqual({ num: 7n, den: 1n });
  });

  it('parses a zero-padded decimal "00.5" to the exact 1/2', () => {
    expect(parseDecimal("00.5")).toEqual({ num: 1n, den: 2n });
  });
});
