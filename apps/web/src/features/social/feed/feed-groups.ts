import type { FeedItemDto } from "../../../ports/wire.ts";
import { daysBetween } from "../../../shared/date.ts";

export interface FeedGroup {
  readonly title: "Hoy" | "Esta semana" | "Antes";
  readonly items: readonly FeedItemDto[];
}

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The calendar date of an instant on the device. The feed carries no time zone, so its headings
 * are drawn against the phone's own day; an item can only land one heading off around midnight.
 */
export function deviceDate(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Hoy, Esta semana (the six days before) and Antes, by each item's `onDate`, in the order given
 * (the API already sorts newest first). A date ahead of `today` counts as today.
 */
export function groupFeed(items: readonly FeedItemDto[], today: string): FeedGroup[] {
  const buckets: Record<FeedGroup["title"], FeedItemDto[]> = {
    Hoy: [],
    "Esta semana": [],
    Antes: [],
  };
  for (const item of items) {
    const age = daysBetween(item.onDate, today);
    buckets[age <= 0 ? "Hoy" : age <= 6 ? "Esta semana" : "Antes"].push(item);
  }
  return (["Hoy", "Esta semana", "Antes"] as const)
    .filter((title) => buckets[title].length > 0)
    .map((title) => ({ title, items: buckets[title] }));
}
