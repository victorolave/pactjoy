import type { Clock } from "../time/clock.port.ts";
import { instant } from "../time/instant.ts";

/**
 * Real {@link Clock} adapter backed by the wall clock (ADR-0009, D8) --
 * the only file allowed to reference `Date` for this purpose.
 */
export function createSystemClock(): Clock {
  return {
    now() {
      return instant(Date.now());
    },
  };
}
