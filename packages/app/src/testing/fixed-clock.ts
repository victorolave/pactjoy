import type { Clock } from "../time/clock.port.ts";
import type { Instant } from "../time/instant.ts";

/** Deterministic {@link Clock} for tests: always returns `at`. */
export function createFixedClock(at: Instant): Clock {
  return {
    now(): Instant {
      return at;
    },
  };
}
