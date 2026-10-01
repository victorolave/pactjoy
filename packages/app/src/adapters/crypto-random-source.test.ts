import { describe, expect, it } from "vitest";
import { createCryptoRandomSource } from "./crypto-random-source.ts";

const fillWith = (words: number[]) => {
  let i = 0;
  return (bytes: Uint8Array) => {
    const word = words[i++];
    if (word === undefined) throw new Error("fill exhausted");
    new DataView(bytes.buffer).setUint32(0, word);
  };
};

describe("createCryptoRandomSource", () => {
  it("returns integers in [0, bound) with the default crypto source", () => {
    const random = createCryptoRandomSource();
    for (let i = 0; i < 2000; i++) {
      const n = random.int(31);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(31);
    }
  });

  it("covers every value of a small bound", () => {
    const random = createCryptoRandomSource();
    const seen = new Set(Array.from({ length: 500 }, () => random.int(5)));
    expect(seen.size).toBe(5);
  });

  it("bound 1 always yields 0", () => {
    expect(createCryptoRandomSource().int(1)).toBe(0);
  });

  it("maps a draw below the unbiased limit with modulo", () => {
    expect(createCryptoRandomSource({ fill: fillWith([100]) }).int(31)).toBe(100 % 31);
  });

  it("rejects draws in the biased tail instead of folding them (no modulo bias)", () => {
    // bound 31: limit = floor(2^32 / 31) * 31; any draw >= limit is rejected and redrawn.
    const limit = Math.floor(2 ** 32 / 31) * 31;
    const random = createCryptoRandomSource({ fill: fillWith([limit, 0xffff_ffff, 7]) });
    expect(random.int(31)).toBe(7);
  });

  it("accepts the largest draw below the limit", () => {
    const limit = Math.floor(2 ** 32 / 31) * 31;
    expect(createCryptoRandomSource({ fill: fillWith([limit - 1]) }).int(31)).toBe(
      (limit - 1) % 31,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 32 + 1])("rejects invalid bound %s", (bound) => {
    expect(() => createCryptoRandomSource().int(bound)).toThrow(RangeError);
  });
});
