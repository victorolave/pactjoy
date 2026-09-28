import { describe, expect, it } from "vitest";
import { fromInt } from "../fraction/fraction.ts";
import { buildDoneCommitment, buildQuantityCommitment } from "../test-support/builders.ts";
import type { Commitment, Target } from "./commitment.ts";
import {
  assertValidCommitments,
  assertValidTarget,
  isLimitIdealWithinTolerance,
  isPositiveReachMinimum,
  isReachMinimumWithinIdeal,
  isValidWeightPercent,
  targetOf,
} from "./commitment.ts";

const minutesTarget = { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) } as const;

describe("targetOf", () => {
  it("returns a reach target with minimum and ideal both 1 for a done commitment", () => {
    const target = targetOf(buildDoneCommitment("read", 25));
    expect(target.direction).toBe("reach");
    expect(target).toMatchObject({
      direction: "reach",
      minimum: { num: 1n, den: 1n },
      ideal: { num: 1n, den: 1n },
    });
  });
});

describe("assertValidCommitments", () => {
  it("accepts commitments whose weights sum to exactly 100 in 5%-steps", () => {
    const commitments: readonly Commitment[] = [
      buildDoneCommitment("a", 25),
      buildQuantityCommitment("b", 25, "minutes", minutesTarget),
      buildQuantityCommitment("c", 30, "minutes", minutesTarget),
      buildQuantityCommitment("d", 20, "minutes", minutesTarget),
    ];
    expect(() => assertValidCommitments(commitments)).not.toThrow();
  });

  it("throws RangeError when weights do not sum to 100", () => {
    const commitments: readonly Commitment[] = [
      buildDoneCommitment("a", 25),
      buildQuantityCommitment("b", 50, "minutes", minutesTarget),
    ];
    expect(() => assertValidCommitments(commitments)).toThrow(RangeError);
  });

  it("throws RangeError when a weight is not a multiple of 5", () => {
    const commitments: readonly Commitment[] = [
      buildDoneCommitment("a", 97),
      buildQuantityCommitment("b", 3, "minutes", minutesTarget),
    ];
    expect(() => assertValidCommitments(commitments)).toThrow(RangeError);
  });

  it("throws RangeError when a weight is below 5 or above 100", () => {
    expect(() => assertValidCommitments([buildDoneCommitment("a", 0)])).toThrow(RangeError);
    expect(() => assertValidCommitments([buildDoneCommitment("a", 105)])).toThrow(RangeError);
  });

  it("throws RangeError when a commitment's target is invalid, even if weights sum to 100", () => {
    const invalidTarget: Target = { direction: "reach", minimum: fromInt(0), ideal: fromInt(0) };
    const commitments: readonly Commitment[] = [
      buildQuantityCommitment("a", 100, "minutes", invalidTarget),
    ];
    expect(() => assertValidCommitments(commitments)).toThrow(RangeError);
  });
});

describe("assertValidTarget", () => {
  it("accepts a valid reach target (0 < minimum <= ideal)", () => {
    expect(() => assertValidTarget(minutesTarget)).not.toThrow();
  });

  it("accepts a valid limit target (0 <= ideal <= tolerance)", () => {
    const target: Target = { direction: "limit", ideal: fromInt(2), tolerance: fromInt(4) };
    expect(() => assertValidTarget(target)).not.toThrow();
  });

  it("throws RangeError for a reach target with ideal = 0 (minimum can never be > 0 and <= 0)", () => {
    const target: Target = { direction: "reach", minimum: fromInt(0), ideal: fromInt(0) };
    expect(() => assertValidTarget(target)).toThrow(RangeError);
  });

  it("throws RangeError for a reach target with minimum > ideal", () => {
    const target: Target = { direction: "reach", minimum: fromInt(30), ideal: fromInt(10) };
    expect(() => assertValidTarget(target)).toThrow(RangeError);
  });

  it("throws RangeError for a limit target with an inverted tolerance (tolerance < ideal)", () => {
    const target: Target = { direction: "limit", ideal: fromInt(4), tolerance: fromInt(2) };
    expect(() => assertValidTarget(target)).toThrow(RangeError);
  });
});

describe("isValidWeightPercent", () => {
  it("accepts every multiple of 5 between 5 and 100", () => {
    expect(isValidWeightPercent(5)).toBe(true);
    expect(isValidWeightPercent(50)).toBe(true);
    expect(isValidWeightPercent(100)).toBe(true);
  });

  it("rejects a value not a multiple of 5, or out of [5, 100]", () => {
    expect(isValidWeightPercent(7)).toBe(false);
    expect(isValidWeightPercent(0)).toBe(false);
    expect(isValidWeightPercent(105)).toBe(false);
  });
});

describe("isPositiveReachMinimum", () => {
  it("accepts a minimum greater than zero", () => {
    expect(isPositiveReachMinimum(fromInt(1))).toBe(true);
  });

  it("rejects a minimum of exactly zero", () => {
    expect(isPositiveReachMinimum(fromInt(0))).toBe(false);
  });
});

describe("isReachMinimumWithinIdeal", () => {
  it("accepts minimum equal to ideal", () => {
    expect(isReachMinimumWithinIdeal(fromInt(30), fromInt(30))).toBe(true);
  });

  it("accepts minimum less than ideal", () => {
    expect(isReachMinimumWithinIdeal(fromInt(10), fromInt(30))).toBe(true);
  });

  it("rejects minimum greater than ideal", () => {
    expect(isReachMinimumWithinIdeal(fromInt(30), fromInt(10))).toBe(false);
  });
});

describe("isLimitIdealWithinTolerance", () => {
  it("accepts ideal equal to tolerance", () => {
    expect(isLimitIdealWithinTolerance(fromInt(2), fromInt(2))).toBe(true);
  });

  it("accepts ideal less than tolerance", () => {
    expect(isLimitIdealWithinTolerance(fromInt(2), fromInt(4))).toBe(true);
  });

  it("rejects ideal greater than tolerance", () => {
    expect(isLimitIdealWithinTolerance(fromInt(4), fromInt(2))).toBe(false);
  });
});
