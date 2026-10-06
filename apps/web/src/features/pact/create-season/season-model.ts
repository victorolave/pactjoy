import { addDays } from "../../../shared/date.ts";
import { dayMonth, longDate, weekdayName } from "../../../shared/format.ts";

export type SeasonLengthWeeks = 4 | 6 | 8 | 12;
export type ReviewCadenceWeeks = 1 | 2 | 3;

export const SEASON_LENGTH_OPTIONS: readonly SeasonLengthWeeks[] = [4, 6, 8, 12];

export const DEFAULT_SEASON_LENGTH: SeasonLengthWeeks = 8;

/** Calendar date YYYY-MM-DD for a timestamp in the given timezone. */
export function todayIso(nowMs: number, timeZone?: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date(nowMs));
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

/**
 * Cadencia por defecto según la duración (design note 1):
 * 4 semanas -> cada 1; 6 y 8 -> cada 2; 12 -> cada 3.
 */
export function reviewCadenceForLength(lengthWeeks: SeasonLengthWeeks): ReviewCadenceWeeks {
  switch (lengthWeeks) {
    case 4:
      return 1;
    case 6:
    case 8:
      return 2;
    case 12:
      return 3;
  }
}

/** Last calendar day of a season of lengthWeeks starting on startDate. */
export function seasonEndDate(startDate: string, lengthWeeks: SeasonLengthWeeks): string {
  return addDays(startDate, lengthWeeks * 7 - 1);
}

/** Design screen 8 copy for the start date section. */
export function seasonEndMessage(startDate: string, lengthWeeks: SeasonLengthWeeks): string {
  const endDate = seasonEndDate(startDate, lengthWeeks);
  const weekday = weekdayName(startDate) ?? "inicio";
  return `Termina el ${longDate(endDate, false)}. Las semanas se cuentan desde el ${weekday}.`;
}

/**
 * Design screen 8 copy under the review cadence segmented control.
 * Owner decision 3: show 'Recomendada para {n} semanas.' only when cadence matches that length's default.
 */
export function seasonCadenceMessage(
  lengthWeeks: SeasonLengthWeeks,
  cadence: ReviewCadenceWeeks,
): string {
  const isDefault = cadence === reviewCadenceForLength(lengthWeeks);
  return isDefault
    ? `Recomendada para ${lengthWeeks} semanas. Unos 60 segundos para ver cómo vas.`
    : "Unos 60 segundos para ver cómo vas.";
}

/**
 * Validation error message for season start date outside the allowed [today..today+30] window.
 * Owner approved copy: "Elige una fecha entre hoy y el {d de mes}."
 */
export function invalidDateMessage(maxDate: string): string {
  return `Elige una fecha entre hoy y el ${dayMonth(maxDate)}.`;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Validates whether a candidate date falls within the valid [today..maxDate] window. */
export function isValidStartDate(date: string, today: string, maxDate: string): boolean {
  if (!ISO_DATE_PATTERN.test(date)) return false;
  return date >= today && date <= maxDate;
}
