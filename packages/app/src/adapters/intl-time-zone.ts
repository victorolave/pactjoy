import type { Instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDate } from "../time/local-date.ts";
import type { TimeZone, TimeZoneId } from "../time/time-zone.port.ts";

/**
 * Real {@link TimeZone} adapter backed by `Intl`/the runtime's IANA
 * timezone database (ADR-0009, D8) -- the only file allowed to reference
 * `Date`/`Intl` for this purpose. `formatToParts` (not string parsing)
 * resolves the civil date regardless of DST transitions, skipped or
 * repeated local hours: ICU already handles those (design #4812's
 * verified facts).
 */
export function createIntlTimeZone(): TimeZone {
  return {
    localDateAt(at: Instant, zone: TimeZoneId): LocalDate {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const parts = formatter.formatToParts(new Date(at));
      const year = parts.find((part) => part.type === "year")?.value;
      const month = parts.find((part) => part.type === "month")?.value;
      const day = parts.find((part) => part.type === "day")?.value;
      return localDate(`${year}-${month}-${day}`);
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
