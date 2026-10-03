const WEEKDAYS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-10-02" -> "Viernes 2 de octubre". The server's local date is read as a calendar date, never
 * as an instant, so the machine's time zone cannot move the day. Anything else is returned as is.
 */
export function longDate(isoDate: string, capitalized = true): string {
  const match = ISO_DATE.exec(isoDate);
  if (match === null) return isoDate;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const monthName = MONTHS[month - 1];
  if (weekday === undefined || monthName === undefined) return isoDate;
  const text = `${weekday} ${day} de ${monthName}`;
  return capitalized ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

/** "+4 pts", and "+1 pt" for a single point (design 22). */
export function pointsText(points: number): string {
  return points === 1 ? "+1 pt" : `+${points} pts`;
}

/** "2026-10-01" -> "jueves" (calendar date, so the machine's time zone cannot move the day). */
export function weekdayName(isoDate: string): string | null {
  const match = ISO_DATE.exec(isoDate);
  if (match === null) return null;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return WEEKDAYS[day.getUTCDay()] ?? null;
}
