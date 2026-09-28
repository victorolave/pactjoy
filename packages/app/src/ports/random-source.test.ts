import { describe, expect, it } from "vitest";
import { createSeededRandomSource } from "../testing/seeded-random.ts";

describe("createSeededRandomSource", () => {
  it("is deterministic: the same seed produces the same sequence", () => {
    const a = createSeededRandomSource(7);
    const b = createSeededRandomSource(7);

    const sequenceA = [a.int(1000), a.int(1000), a.int(1000)];
    const sequenceB = [b.int(1000), b.int(1000), b.int(1000)];

    expect(sequenceA).toEqual(sequenceB);
  });

  it("different seeds produce different sequences", () => {
    const a = createSeededRandomSource(1);
    const b = createSeededRandomSource(2);

    const sequenceA = [a.int(1_000_000), a.int(1_000_000), a.int(1_000_000)];
    const sequenceB = [b.int(1_000_000), b.int(1_000_000), b.int(1_000_000)];

    expect(sequenceA).not.toEqual(sequenceB);
  });

  it("always returns an integer within [0, boundExclusive)", () => {
    const random = createSeededRandomSource(42);

    for (let i = 0; i < 50; i += 1) {
      const value = random.int(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });

  it("rejects a non-positive boundExclusive", () => {
    const random = createSeededRandomSource(1);

    expect(() => random.int(0)).toThrow(RangeError);
    expect(() => random.int(-1)).toThrow(RangeError);
  });
});
