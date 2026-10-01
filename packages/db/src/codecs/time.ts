import { type Instant, instant } from "@pactjoy/app";

// Postgres text output for timestamptz under DateStyle ISO: the offset is
// always present and sign-prefixed; the fraction has 0 to 6 digits.
const TIMESTAMPTZ =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([+-])(\d{2})(?::(\d{2}))?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * timestamptz text -> {@link Instant}. We only ever write whole milliseconds,
 * so truncating the microsecond digits is exact for our own data. Anything
 * the strict pattern does not cover (infinity, BC, a missing offset) throws:
 * a value we cannot place exactly is corruption, never a guess.
 *
 * @throws {Error} on text that is not a supported timestamptz.
 */
export function parseTimestamptz(text: string): Instant {
  const m = TIMESTAMPTZ.exec(text);
  if (m === null) throw new Error(`Unsupported timestamptz value: ${JSON.stringify(text)}`);
  const [, year, month, day, hour, minute, second, fraction, sign, offsetHours, offsetMinutes] =
    m as unknown as string[];
  const millis = Number((fraction ?? "").padEnd(3, "0").slice(0, 3));
  const local = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millis,
  );
  const roundTrip = new Date(local);
  if (
    roundTrip.getUTCMonth() !== Number(month) - 1 ||
    roundTrip.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  ) {
    throw new Error(`Invalid timestamptz value: ${JSON.stringify(text)}`);
  }
  const offsetMs = (Number(offsetHours) * 60 + Number(offsetMinutes ?? 0)) * 60_000;
  return instant(sign === "-" ? local + offsetMs : local - offsetMs);
}

/** {@link Instant} -> ISO-8601 text, bound with `$n::timestamptz`. */
export function formatInstant(value: Instant): string {
  return new Date(value).toISOString();
}

/**
 * date text -> the raw `YYYY-MM-DD` string. No `Date` is involved, so the
 * process time zone cannot shift it; callers brand it with `localDate`.
 *
 * @throws {Error} on anything but a plain calendar date (e.g. infinity).
 */
export function parseDate(text: string): string {
  if (!DATE.test(text)) throw new Error(`Unsupported date value: ${JSON.stringify(text)}`);
  return text;
}
