import { describe, expect, it } from "vitest";
import { instant } from "./instant.ts";

describe("instant", () => {
  it("brands a non-negative safe-integer epoch-ms value", () => {
    const value = instant(1_700_000_000_000);

    expect(value).toBe(1_700_000_000_000);
  });

  it("rejects a negative value", () => {
    expect(() => instant(-1)).toThrow(RangeError);
  });

  it("rejects a non-integer value", () => {
    expect(() => instant(1.5)).toThrow(RangeError);
  });
});
