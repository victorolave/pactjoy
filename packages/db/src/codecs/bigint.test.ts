import { describe, expect, it } from "vitest";
import { formatInt8, parseInt8 } from "./bigint.ts";

describe("int8 codec", () => {
  it("round-trips values beyond 2^53 exactly", () => {
    const big = 2n ** 53n + 1n;
    expect(parseInt8(formatInt8(big))).toBe(big);
    expect(parseInt8("9007199254740993")).toBe(9007199254740993n);
  });

  it("covers the int8 bounds and negatives", () => {
    expect(parseInt8("9223372036854775807")).toBe(9223372036854775807n);
    expect(parseInt8("-9223372036854775808")).toBe(-9223372036854775808n);
    expect(formatInt8(-5n)).toBe("-5");
  });

  it("throws on non-integer text", () => {
    expect(() => parseInt8("1.5")).toThrow();
    expect(() => parseInt8("")).toThrow();
    expect(() => parseInt8(" 5")).toThrow();
    expect(() => parseInt8("0x10")).toThrow();
  });
});
