import { describe, expect, it } from "vitest";
import { createSeededRandomSource } from "../testing/seeded-random.ts";
import { mintObjectKey, OBJECT_KEY_PATTERN } from "./object-key.ts";

describe("mintObjectKey", () => {
  it("mints o/{32 lowercase hex}.jpg from the RandomSource", () => {
    const key = mintObjectKey(createSeededRandomSource(7));
    expect(key).toMatch(/^o\/[0-9a-f]{32}\.jpg$/);
    expect(OBJECT_KEY_PATTERN.test(key)).toBe(true);
  });

  it("is deterministic for a seed and different across draws", () => {
    const a = createSeededRandomSource(7);
    const b = createSeededRandomSource(7);
    const first = mintObjectKey(a);
    expect(mintObjectKey(b)).toBe(first);
    expect(mintObjectKey(a)).not.toBe(first);
  });

  it("carries nothing but randomness: no ids, no path segments", () => {
    const key = mintObjectKey(createSeededRandomSource(1));
    expect(key.split("/")).toHaveLength(2);
  });

  it("pattern rejects traversal, uppercase and wrong length", () => {
    expect(OBJECT_KEY_PATTERN.test("o/../etc.jpg")).toBe(false);
    expect(OBJECT_KEY_PATTERN.test(`o/${"A".repeat(32)}.jpg`)).toBe(false);
    expect(OBJECT_KEY_PATTERN.test(`o/${"a".repeat(31)}.jpg`)).toBe(false);
  });
});
