import type { Instant } from "../time/instant.ts";

/** What a counter limits. A closed list, so the table can pin it with a CHECK. */
export type RateLimitAction = "joinCircle";

/**
 * One fixed window of one subject (ADR-0020). `subject` is `user:<userId>` or `network:<keyed
 * hash>`, never a raw address. The window ends at `windowStart + windowSeconds`.
 */
export interface RateLimitCounter {
  readonly action: RateLimitAction;
  readonly subject: string;
  readonly windowStart: Instant;
  readonly windowSeconds: number;
}

/**
 * Storage port of the rate-limit counters (ADR-0020). Counters have no history and no version:
 * each hit is an atomic increment, so concurrent attempts can never lose a count.
 */
export interface RateLimitRepository {
  /**
   * Adds one hit to each counter (creating it at 1) and returns each count after the hit, in the
   * order given.
   */
  hit(counters: readonly RateLimitCounter[]): Promise<readonly number[]>;
  /** Deletes every counter whose window ended at or before `now`. */
  sweepExpired(now: Instant): Promise<void>;
  /** Account erasure (ADR-0019): deletes every counter of `subjects`. `[]` is a no-op. */
  deleteBySubjects(subjects: readonly string[]): Promise<void>;
}
