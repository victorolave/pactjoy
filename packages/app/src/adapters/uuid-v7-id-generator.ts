import type { IdGenerator } from "../ports/id-generator.ts";
import type { Clock } from "../time/clock.port.ts";
import { createSystemClock } from "./system-clock.ts";

export interface UuidV7Options {
  /** Source of the 48-bit millisecond timestamp. Defaults to the wall clock. */
  readonly clock?: Clock;
  /** Fills the buffer with random bytes. Defaults to `crypto.getRandomValues`. */
  readonly fill?: (bytes: Uint8Array) => void;
}

// The ES2022 lib has no `crypto`; Node 20+, Deno and browsers all provide this global.
declare const crypto: { getRandomValues(bytes: Uint8Array): Uint8Array };

const TWO_POW_32 = 0x1_0000_0000;

/**
 * {@link IdGenerator} producing UUID v7 (RFC 9562): 48-bit Unix ms, version
 * nibble 7, 74 random bits, variant 10. Ids are time-ordered across
 * milliseconds only; within one millisecond they are NOT monotonic, and
 * nothing may order by id (Postgres orders by `insert_seq`). Uses only the
 * standard `crypto.getRandomValues`, so it runs on Node and Deno alike.
 */
export function createUuidV7IdGenerator(options: UuidV7Options = {}): IdGenerator {
  const clock = options.clock ?? createSystemClock();
  const fill = options.fill ?? ((bytes: Uint8Array) => void crypto.getRandomValues(bytes));
  return {
    next(): string {
      const bytes = new Uint8Array(16);
      fill(bytes);
      const ms = clock.now();
      // Only the low 48 bits of `ms` are written: a timestamp above 2^48 ms (year
      // 10889) would be truncated. Theoretical, since `Instant` cannot reach it.
      const high = Math.floor(ms / TWO_POW_32);
      const low = ms % TWO_POW_32;
      bytes[0] = (high >>> 8) & 0xff;
      bytes[1] = high & 0xff;
      bytes[2] = (low >>> 24) & 0xff;
      bytes[3] = (low >>> 16) & 0xff;
      bytes[4] = (low >>> 8) & 0xff;
      bytes[5] = low & 0xff;
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  };
}
