import type { RandomSource } from "../ports/random-source.ts";

export interface CryptoRandomSourceOptions {
  /** Fills the buffer with random bytes. Defaults to `crypto.getRandomValues`. */
  readonly fill?: (bytes: Uint8Array) => void;
}

// The ES2022 lib has no `crypto`; Node 20+, Deno and browsers all provide this global.
declare const crypto: { getRandomValues(bytes: Uint8Array): Uint8Array };

const TWO_POW_32 = 0x1_0000_0000;

/**
 * Production {@link RandomSource} backed by the standard
 * `crypto.getRandomValues`, so it runs on Node and Deno alike. Draws 32-bit
 * words and uses rejection sampling: words in the biased tail (at or above the
 * largest multiple of the bound) are redrawn, so every value is equally likely.
 */
export function createCryptoRandomSource(options: CryptoRandomSourceOptions = {}): RandomSource {
  const fill = options.fill ?? ((bytes: Uint8Array) => void crypto.getRandomValues(bytes));
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  return {
    int(boundExclusive: number): number {
      if (!Number.isInteger(boundExclusive) || boundExclusive <= 0 || boundExclusive > TWO_POW_32) {
        throw new RangeError(
          `int: boundExclusive must be an integer in [1, 2^32], got ${boundExclusive}`,
        );
      }
      const limit = Math.floor(TWO_POW_32 / boundExclusive) * boundExclusive;
      for (;;) {
        fill(bytes);
        const word = view.getUint32(0);
        if (word < limit) return word % boundExclusive;
      }
    },
  };
}
