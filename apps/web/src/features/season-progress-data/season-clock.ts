import type { Clock } from "../../ports/clock.ts";

const formatters = new Map<string, Intl.DateTimeFormat>();
/** The longest local day (a DST change) plus margin: the next day always starts before this. */
const SEARCH_WINDOW_MS = 27 * 60 * 60 * 1000;
/** Fire just after the boundary, so the server already sees the new day. */
const SLACK_MS = 500;
/** setTimeout stores its delay in 32 bits; a longer one fires at once. */
const MAX_TIMEOUT_MS = 2_000_000_000;

/** The calendar day (YYYY-MM-DD) of `nowMs` in the season's zone, never the device's. */
export function seasonDate(nowMs: number, timeZone: string): string {
  let format = formatters.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  return format.format(nowMs);
}

/**
 * The first instant after `nowMs` that belongs to the next season-local day. A binary search over
 * the zone's own calendar, so 23- and 25-hour DST days need no special case.
 */
export function nextSeasonDayStartMs(nowMs: number, timeZone: string): number {
  const today = seasonDate(nowMs, timeZone);
  let before = nowMs;
  let after = nowMs + SEARCH_WINDOW_MS;
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (seasonDate(middle, timeZone) === today) before = middle;
    else after = middle;
  }
  return after;
}

/**
 * Calls `onNewDay` whenever the season-local day changes: entries close, grace ends and the season
 * ends at local midnights. A timer fires at the next one; `onResume` (returning to the app) catches
 * up when the timer was suspended. Returns the stop function.
 */
export function watchSeasonDay(
  clock: Clock,
  timeZone: string,
  onResume: (check: () => void) => () => void,
  onNewDay: () => void,
): () => void {
  let day = seasonDate(clock.nowMs(), timeZone);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (nowMs: number) => {
    clearTimeout(timer);
    const delay = nextSeasonDayStartMs(nowMs, timeZone) - nowMs + SLACK_MS;
    timer = setTimeout(check, Math.min(delay, MAX_TIMEOUT_MS));
  };
  function check() {
    const nowMs = clock.nowMs();
    const today = seasonDate(nowMs, timeZone);
    if (today !== day) {
      day = today;
      onNewDay();
    }
    schedule(nowMs);
  }
  schedule(clock.nowMs());
  const stopResume = onResume(check);
  return () => {
    clearTimeout(timer);
    stopResume();
  };
}
