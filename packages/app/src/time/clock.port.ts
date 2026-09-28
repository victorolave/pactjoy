import type { Instant } from "./instant.ts";

/**
 * The only source of "now" a use case may depend on (ADR-0008/ADR-0009,
 * D7). Production reads the real wall clock only inside
 * `src/adapters/system-clock.ts`; everything else takes a `Clock`.
 */
export interface Clock {
  now(): Instant;
}
