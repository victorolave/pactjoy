import type { Instant } from "./instant.ts";
import type { LocalDate } from "./local-date.ts";

/**
 * A validated IANA timezone identifier (e.g. "Europe/Madrid"). This
 * constructor only checks non-emptiness -- full IANA validity requires
 * `Intl`, confined to `src/adapters/` (ADR-0009, D8), so callers check it
 * via {@link TimeZone.isValidZone} first.
 */
export type TimeZoneId = string & { readonly __brand: "TimeZoneId" };

/** @throws {RangeError} if `value` is empty. */
export function timeZoneId(value: string): TimeZoneId {
  if (value.length === 0) {
    throw new RangeError("timeZoneId: value must be a non-empty string");
  }
  return value as TimeZoneId;
}

/** A local wall-clock moment: the civil date plus the whole minutes since its local midnight, 0..1439. */
export interface LocalTime {
  readonly date: LocalDate;
  readonly minuteOfDay: number;
}

/** Minutes in a civil day: a `minuteOfDay` is in [0, MINUTES_PER_DAY). */
export const MINUTES_PER_DAY = 1440;

/** @throws {RangeError} unless `minuteOfDay` is an integer in [0, 1440). */
export function assertMinuteOfDay(minuteOfDay: number): void {
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= MINUTES_PER_DAY) {
    throw new RangeError(`minuteOfDay: ${minuteOfDay} is not an integer in [0, 1440)`);
  }
}

/**
 * Resolves a real instant to the civil calendar date it falls on in a
 * given IANA zone (ADR-0008/ADR-0009, D7). Production reads the real
 * timezone database only inside `src/adapters/intl-time-zone.ts`;
 * everything else takes a `TimeZone`.
 */
export interface TimeZone {
  /** @throws {RangeError} if `zone` is not a valid IANA timezone identifier. */
  localDateAt(at: Instant, zone: TimeZoneId): LocalDate;
  /**
   * The local date and minute of day (floored) an instant falls on (ADR-0017: scheduled notices).
   * @throws {RangeError} if `zone` is not a valid IANA timezone identifier.
   */
  localTimeAt(at: Instant, zone: TimeZoneId): LocalTime;
  /**
   * The instant a local wall-clock time happens. A time inside a spring-forward gap is shifted
   * forward by the gap; a time repeated by a fall-back takes the EARLIER instant (ADR-0017).
   * @throws {RangeError} if `zone` is invalid or `minuteOfDay` is not an integer in [0, 1440).
   */
  instantAt(date: LocalDate, minuteOfDay: number, zone: TimeZoneId): Instant;
  isValidZone(zone: string): boolean;
}
