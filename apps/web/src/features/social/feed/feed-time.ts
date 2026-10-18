import { daysBetween } from "../../../shared/date.ts";
import { deviceDate } from "./feed-groups.ts";

export interface FeedTime {
  /** The Spanish text shown, and the accessible text: the label itself. */
  readonly label: string;
  /** The ISO instant when the label is relative to it, otherwise the ISO calendar date. */
  readonly dateTime: string;
}

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
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
];

/**
 * When a feed item happened, as design 31a draws it: relative within today ("hace 5 min",
 * "hace 3 h"), "Ayer", the weekday for the rest of the six days before ("Miércoles"), and the date
 * after that ("25 de agosto", with the year only when it is not this year). The day is the item's
 * `onDate` against the device's today, the same reading `groupFeed` uses for its headings.
 *
 * Today without an instant (system items), under a minute old or ahead of the device clock says
 * "Hoy": a precise-looking "hace 0 min" would claim more than the data knows.
 */
export function feedTime(
  item: { readonly onDate: string; readonly at: string | null },
  nowMs: number,
): FeedTime {
  const today = deviceDate(nowMs);
  const age = daysBetween(item.onDate, today);
  if (age <= 0) {
    const minutes = item.at === null ? 0 : Math.floor((nowMs - Date.parse(item.at)) / 60_000);
    if (item.at === null || Number.isNaN(minutes) || minutes < 1) {
      return { label: "Hoy", dateTime: item.onDate };
    }
    return {
      label: minutes < 60 ? `hace ${minutes} min` : `hace ${Math.floor(minutes / 60)} h`,
      dateTime: item.at,
    };
  }
  if (age === 1) return { label: "Ayer", dateTime: item.onDate };
  const [year, month, day] = item.onDate.split("-").map(Number) as [number, number, number];
  if (age <= 6) {
    return {
      label: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] as string,
      dateTime: item.onDate,
    };
  }
  const base = `${day} de ${MONTHS[month - 1]}`;
  const sameYear = year === Number(today.slice(0, 4));
  return { label: sameYear ? base : `${base} de ${year}`, dateTime: item.onDate };
}
