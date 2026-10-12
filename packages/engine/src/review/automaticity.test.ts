import { describe, expect, it } from "vitest";
import { frac, fromInt, gte } from "../fraction/fraction.ts";
import { fr } from "../test-support/fraction-literal.ts";
import { automaticityOf, comparableAutomaticity } from "./automaticity.ts";

describe("automaticityOf (REQ-A4, SC-30..32)", () => {
  it("is the exact mean of the answered items", () => {
    expect(automaticityOf([4, 4, 5, 5])).toEqual(fr("9/2"));
    expect(automaticityOf([3, 3, 3, 4])).toEqual(fr("13/4"));
    expect(automaticityOf([3, 4, 3, 4])).toEqual(fr("7/2"));
  });

  it("an item-1-only review is that item", () => {
    expect(automaticityOf([6])).toEqual(fromInt(6));
  });

  it("is exact, with no float error (SC-32)", () => {
    expect(automaticityOf([1, 1, 1, 2])).toEqual(frac(5n, 4n));
  });

  it("compares on exact fractions against the SRBAI threshold 5 (SC-32)", () => {
    expect(gte(automaticityOf([5, 5, 5, 4]), fromInt(5))).toBe(false);
    expect(gte(automaticityOf([5, 5, 5, 5]), fromInt(5))).toBe(true);
  });

  it.each([[[0]], [[8]], [[3.5]], [[4, 0]], [[Number.NaN]], [[]]])(
    "rejects %j with a RangeError (SC-31)",
    (items) => {
      expect(() => automaticityOf(items)).toThrow(RangeError);
    },
  );
});

describe("comparableAutomaticity (REQ-A7, SC-50..52)", () => {
  it("names an improvement with the displayed from and to", () => {
    expect(comparableAutomaticity(fr("9/2"), fr("7/2"))).toEqual({
      improved: true,
      from: "3,5",
      to: "4,5",
    });
  });

  it("an equal or lower score is not an improvement (SC-50)", () => {
    expect(comparableAutomaticity(fromInt(4), fromInt(4)).improved).toBe(false);
    expect(comparableAutomaticity(fromInt(3), fromInt(5)).improved).toBe(false);
  });

  it("judges on the rounded tenths: 3.25 -> 3.30 displays 3,3 twice, so no improvement (SC-52)", () => {
    const reference = fr("13/4");
    const current = fr("33/10");
    expect(comparableAutomaticity(current, reference)).toEqual({
      improved: false,
      from: "3,3",
      to: "3,3",
    });
  });

  it("compares the two scores it is given as they are (the caller picks like for like)", () => {
    expect(comparableAutomaticity(fromInt(5), fr("9/2")).improved).toBe(true);
  });
});
