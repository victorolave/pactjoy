import type { RandomSource } from "../ports/random-source.ts";

/**
 * Deterministic {@link RandomSource} for tests: an xorshift32 PRNG seeded
 * by the caller, so the same seed always produces the same sequence.
 */
export function createSeededRandomSource(seed: number): RandomSource {
  let state = seed >>> 0 || 1;

  function nextUint32(): number {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  }

  return {
    int(boundExclusive: number): number {
      if (!Number.isInteger(boundExclusive) || boundExclusive <= 0) {
        throw new RangeError(
          `int: boundExclusive must be a positive integer, got ${boundExclusive}`,
        );
      }
      return nextUint32() % boundExclusive;
    },
  };
}
