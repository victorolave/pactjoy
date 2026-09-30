import { frac, fromInt, parseDecimal } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { toDecimalString } from "./decimal.ts";

describe("toDecimalString", () => {
  it.each([
    ["0", "0"],
    ["7", "7"],
    ["7.5", "7.5"],
    ["7.50", "7.5"],
    ["0.05", "0.05"],
    ["0.5", "0.5"],
    ["12.34", "12.34"],
    ["999999999.99", "999999999.99"],
  ])("round-trips %s as %s", (input, output) => {
    expect(toDecimalString(parseDecimal(input))).toBe(output);
  });

  it("renders whole fractions without decimals", () => {
    expect(toDecimalString(fromInt(30))).toBe("30");
    expect(toDecimalString(frac(300n, 10n))).toBe("30");
  });

  it("is exact for values beyond the float range", () => {
    expect(toDecimalString(parseDecimal("123456789012345678.25"))).toBe("123456789012345678.25");
  });

  it("refuses a value that has no exact 2-decimal form instead of rounding it", () => {
    expect(() => toDecimalString(frac(1n, 3n))).toThrow(RangeError);
    expect(() => toDecimalString(frac(1n, 1000n))).toThrow(RangeError);
  });

  it("refuses negative values, which no threshold can hold", () => {
    expect(() => toDecimalString(frac(-1n))).toThrow(RangeError);
  });
});
