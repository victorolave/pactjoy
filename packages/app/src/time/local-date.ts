/**
 * A civil calendar date in a fixed IANA timezone, as "YYYY-MM-DD"
 * (ADR-0009). The only way to get one from a real instant is
 * `TimeZone.localDateAt` (`src/adapters/intl-time-zone.ts`); tests build
 * one directly with `localDate`, same brand pattern as `shared/ids.ts`.
 *
 * `epochDay`/`localDateOfEpochDay` are the pure integer (proleptic
 * Gregorian) conversion pair every other date computation in this
 * package builds on -- never a `Date`/`Intl`/`Temporal` global (D8).
 * Restricted to 1970-01-01 onward: every date this app ever produces is
 * "today" or later (A6, seasons start within 30 days of creation).
 */
export type LocalDate = string & { readonly __brand: "LocalDate" };

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const EPOCH_SHIFT = 719_468;
const DAYS_PER_ERA = 146_097;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  // Callers only reach this once `month` is already known to be in [1, 12]
  // (see `localDate`'s short-circuited range check); the fallback below
  // never actually triggers, it only satisfies `noUncheckedIndexedAccess`.
  return month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 31);
}

/** Integer division, exact for the non-negative operands this module only ever uses. */
function idiv(a: number, b: number): number {
  return (a - (a % b)) / b;
}

function parseComponents(value: string): { year: number; month: number; day: number } {
  const match = PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`localDate: ${value} is not in YYYY-MM-DD format`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** @throws {RangeError} if `value` is not a real "YYYY-MM-DD" calendar date on or after 1970-01-01. */
export function localDate(value: string): LocalDate {
  const { year, month, day } = parseComponents(value);
  if (year < 1970) {
    throw new RangeError(`localDate: ${value} is before this app's epoch floor (1970-01-01)`);
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`localDate: ${value} is not a real calendar date`);
  }
  return value as LocalDate;
}

/**
 * Days since 1970-01-01 (which is day 0), via the proleptic Gregorian
 * "days_from_civil" algorithm (Hinnant). Pure integer math.
 */
export function epochDay(date: LocalDate): number {
  const { year, month, day } = parseComponents(date);
  const y = month <= 2 ? year - 1 : year;
  const era = idiv(y, 400);
  const yearOfEra = y - era * 400;
  const monthIndex = month + (month > 2 ? -3 : 9);
  const dayOfYear = idiv(153 * monthIndex + 2, 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + idiv(yearOfEra, 4) - idiv(yearOfEra, 100) + dayOfYear;
  return era * DAYS_PER_ERA + dayOfEra - EPOCH_SHIFT;
}

/** The inverse of {@link epochDay}: the calendar date `days` days after 1970-01-01. */
export function localDateOfEpochDay(days: number): LocalDate {
  const z = days + EPOCH_SHIFT;
  const era = idiv(z, DAYS_PER_ERA);
  const dayOfEra = z - era * DAYS_PER_ERA;
  const yearOfEra = idiv(
    dayOfEra - idiv(dayOfEra, 1460) + idiv(dayOfEra, 36_524) - idiv(dayOfEra, 146_096),
    365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + idiv(yearOfEra, 4) - idiv(yearOfEra, 100));
  const monthIndex = idiv(5 * dayOfYear + 2, 153);
  const day = dayOfYear - idiv(153 * monthIndex + 2, 5) + 1;
  const month = monthIndex + (monthIndex < 10 ? 3 : -9);
  const finalYear = month <= 2 ? year + 1 : year;
  return `${String(finalYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as LocalDate;
}
