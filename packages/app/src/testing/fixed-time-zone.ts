import { type Instant, instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { epochDay, localDateOfEpochDay } from "../time/local-date.ts";
import { assertMinuteOfDay, type LocalTime, type TimeZone } from "../time/time-zone.port.ts";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export interface FixedOffsetTimeZoneOptions {
  /** Constant UTC offset in minutes (no DST) -- e.g. `-180` for UTC-3. */
  readonly offsetMinutes: number;
}

/**
 * Deterministic {@link TimeZone} test double: a single fixed UTC offset,
 * no DST, no `Intl`. For DST-transition coverage see
 * `adapters/intl-time-zone.test.ts`, which exercises the real adapter.
 */
export function createFixedOffsetTimeZone(options: FixedOffsetTimeZoneOptions): TimeZone {
  function localTimeAt(at: Instant): LocalTime {
    const localMs = at + options.offsetMinutes * MS_PER_MINUTE;
    // Floor division without `Math` (banned outside adapters): JS's `%`
    // keeps the dividend's sign, so a plain `(a - a%b)/b` truncates
    // toward zero instead of flooring when `localMs` is negative.
    // Normalizing the remainder into [0, MS_PER_DAY) first makes the
    // subtraction floor instead.
    const remainder = ((localMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
    const days = (localMs - remainder) / MS_PER_DAY;
    const minuteOfDay = (remainder - (remainder % MS_PER_MINUTE)) / MS_PER_MINUTE;
    return { date: localDateOfEpochDay(days), minuteOfDay };
  }

  return {
    localDateAt(at: Instant): LocalDate {
      return localTimeAt(at).date;
    },
    localTimeAt,
    instantAt(date: LocalDate, minuteOfDay: number): Instant {
      assertMinuteOfDay(minuteOfDay);
      return instant(
        epochDay(date) * MS_PER_DAY + (minuteOfDay - options.offsetMinutes) * MS_PER_MINUTE,
      );
    },
    isValidZone(zone: string): boolean {
      return zone.length > 0;
    },
  };
}
