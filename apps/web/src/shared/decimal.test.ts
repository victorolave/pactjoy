import { describe, expect, it } from "vitest";
import { addScaled, fromScaled, roundToMultiple, toScaled } from "./decimal.ts";

describe("toScaled", () => {
  it("reads non-negative decimals with up to two places, as exact integers (value x 100)", () => {
    expect(toScaled("10")).toBe(1000n);
    expect(toScaled("10.5")).toBe(1050n);
    expect(toScaled("0.25")).toBe(25n);
    expect(toScaled("0")).toBe(0n);
  });

  it("accepts a comma as the decimal separator and ignores surrounding spaces", () => {
    expect(toScaled("10,5")).toBe(1050n);
    expect(toScaled("  7 ")).toBe(700n);
  });

  it("strips leading zeros", () => {
    expect(toScaled("0010")).toBe(1000n);
  });

  it.each(["", " ", "abc", "-3", "1.234", ".5", "5.", "1e3", "1,2,3", "10 5"])(
    "rejects %j",
    (raw) => {
      expect(toScaled(raw)).toBeNull();
    },
  );

  it("is exact where a float is not", () => {
    // 0.1 + 0.2 !== 0.3 in floating point; scaled integers add exactly.
    expect((toScaled("0.1") ?? 0n) + (toScaled("0.2") ?? 0n)).toBe(toScaled("0.3"));
  });

  it("does not lose precision on large values", () => {
    expect(toScaled("123456789012345678")).toBe(12345678901234567800n);
  });
});

describe("fromScaled", () => {
  it("writes the shortest exact decimal string", () => {
    expect(fromScaled(1000n)).toBe("10");
    expect(fromScaled(1050n)).toBe("10.5");
    expect(fromScaled(25n)).toBe("0.25");
    expect(fromScaled(5n)).toBe("0.05");
    expect(fromScaled(0n)).toBe("0");
  });

  it("round-trips with toScaled", () => {
    for (const text of ["0", "1", "0.5", "12.25", "100", "99.99"]) {
      expect(fromScaled(toScaled(text) ?? -1n)).toBe(text);
    }
  });
});

describe("addScaled", () => {
  it("adds and subtracts, never going below zero", () => {
    expect(addScaled(1000n, 500n)).toBe(1500n);
    expect(addScaled(1000n, -500n)).toBe(500n);
    expect(addScaled(300n, -500n)).toBe(0n);
  });
});

describe("roundToMultiple", () => {
  it("rounds to the nearest multiple, halves up", () => {
    expect(roundToMultiple(1200n, 500n)).toBe(1000n);
    expect(roundToMultiple(1300n, 500n)).toBe(1500n);
    expect(roundToMultiple(1250n, 500n)).toBe(1500n);
    expect(roundToMultiple(210n, 50n)).toBe(200n);
    expect(roundToMultiple(630n, 50n)).toBe(650n);
  });

  it("leaves an exact multiple alone", () => {
    expect(roundToMultiple(1500n, 500n)).toBe(1500n);
  });
});
