import { describe, expect, it } from "vitest";
import { frac, fromInt } from "../fraction/fraction.ts";
import { displayPercent, displayPoints, displayPointsDecimal } from "./display.ts";

describe("displayPointsDecimal", () => {
  it("rounds half-up to two decimals and drops trailing zeros", () => {
    expect(displayPointsDecimal(frac(25n, 4n))).toBe("6.25");
    expect(displayPointsDecimal(frac(200n, 3n))).toBe("66.67");
    expect(displayPointsDecimal(fromInt(8))).toBe("8");
    expect(displayPointsDecimal(frac(5n, 2n))).toBe("2.5");
  });
});

describe("displayPoints", () => {
  it("rounds an exact fraction half-up to a whole point", () => {
    // 2503/1000 * ... simpler: 5/2 = 2.5 -> rounds up to 3 (D10 half-up)
    expect(displayPoints(frac(5n, 2n))).toBe(3);
  });

  it("rounds down when the fractional part is below one half", () => {
    // 700/3 = 233.33... -> 233
    expect(displayPoints(frac(700n, 3n))).toBe(233);
  });

  it("returns a plain whole number for an already-integer points total", () => {
    expect(displayPoints(fromInt(1000))).toBe(1000);
  });

  it("never exceeds 1000 for the season's own maximum", () => {
    expect(displayPoints(fromInt(1000))).toBeLessThanOrEqual(1000);
  });
});

describe("displayPercent", () => {
  it("scales an exact progress fraction to a rounded whole percent", () => {
    // 2/3 * 100 = 200/3 = 66.66... -> 67
    expect(displayPercent(frac(2n, 3n))).toBe(67);
  });

  it("rounds a lower fractional remainder down", () => {
    // 1/3 * 100 = 100/3 = 33.33... -> 33
    expect(displayPercent(frac(1n, 3n))).toBe(33);
  });

  it("returns 100 for a complete (1/1) fraction", () => {
    expect(displayPercent(fromInt(1))).toBe(100);
  });

  it("returns 0 for a zero fraction", () => {
    expect(displayPercent(fromInt(0))).toBe(0);
  });
});
