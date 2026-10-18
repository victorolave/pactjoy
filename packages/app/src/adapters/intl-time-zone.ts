import { type Instant, instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDate } from "../time/local-date.ts";
import {
  assertMinuteOfDay,
  type LocalTime,
  type TimeZone,
  type TimeZoneId,
} from "../time/time-zone.port.ts";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function wallClockFormatter(zone: TimeZoneId): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

/** The civil wall clock at `at` in `zone`, read with `formatToParts` (never string parsing). */
function wallClockAt(at: number, zone: TimeZoneId): WallClock {
  const parts = wallClockFormatter(zone).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

/** The wall clock read as if it were UTC, in epoch ms (milliseconds carried over from `at`). */
function wallMsAt(at: number, zone: TimeZoneId): number {
  const wall = wallClockAt(at, zone);
  const ms = ((at % 1000) + 1000) % 1000;
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, ms);
}

/** The zone's UTC offset at `at`, in ms (local = utc + offset). */
function offsetAt(at: number, zone: TimeZoneId): number {
  return wallMsAt(at, zone) - at;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/**
 * Real {@link TimeZone} adapter backed by `Intl`/the runtime's IANA
 * timezone database (ADR-0009, D8) -- the only file allowed to reference
 * `Date`/`Intl` for this purpose. `formatToParts` (not string parsing)
 * resolves the civil date regardless of DST transitions, skipped or
 * repeated local hours: ICU already handles those (design #4812's
 * verified facts).
 */
export function createIntlTimeZone(): TimeZone {
  function localTimeAt(at: Instant, zone: TimeZoneId): LocalTime {
    const wall = wallClockAt(at, zone);
    return {
      date: localDate(`${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`),
      minuteOfDay: wall.hour * 60 + wall.minute,
    };
  }

  return {
    localDateAt(at: Instant, zone: TimeZoneId): LocalDate {
      return localTimeAt(at, zone).date;
    },
    localTimeAt,
    /**
     * Two-pass offset resolution (ADR-0017): the offsets a day before and a day after the wall
     * time give the only two candidate instants (a zone changes offset at most once in a day). A
     * candidate counts when it reads back as the same wall time; with two (a fall-back overlap)
     * the earlier wins; with none (a spring-forward gap) the pre-transition offset is used, which
     * lands the same distance past the gap.
     */
    instantAt(date: LocalDate, minuteOfDay: number, zone: TimeZoneId): Instant {
      assertMinuteOfDay(minuteOfDay);
      const [year, month, day] = date.split("-").map(Number) as [number, number, number];
      const wall = Date.UTC(year, month - 1, day) + minuteOfDay * MS_PER_MINUTE;
      const before = wall - offsetAt(wall - MS_PER_DAY, zone);
      const after = wall - offsetAt(wall + MS_PER_DAY, zone);
      const valid = [before, after].filter((candidate) => wallMsAt(candidate, zone) === wall);
      return instant(valid.length > 0 ? Math.min(...valid) : before);
    },
    isValidZone(zone: string): boolean {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
  };
}
