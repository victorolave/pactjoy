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

/**
 * Resolves a real instant to the civil calendar date it falls on in a
 * given IANA zone (ADR-0008/ADR-0009, D7). Production reads the real
 * timezone database only inside `src/adapters/intl-time-zone.ts`;
 * everything else takes a `TimeZone`.
 */
export interface TimeZone {
  /** @throws {RangeError} if `zone` is not a valid IANA timezone identifier. */
  localDateAt(at: Instant, zone: TimeZoneId): LocalDate;
  isValidZone(zone: string): boolean;
}
