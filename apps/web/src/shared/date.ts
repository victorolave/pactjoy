/** Adds days to a calendar date ("2026-09-28" + 27 -> "2026-10-25"), in UTC so no time zone moves it. */
export function addDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  const moved = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return moved.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates (to - from). "2026-08-23" and "2026-08-25" -> 2. */
export function daysBetween(fromIso: string, toIso: string): number {
  const matchFrom = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromIso);
  const matchTo = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIso);
  if (matchFrom === null || matchTo === null) return 0;
  const from = Date.UTC(Number(matchFrom[1]), Number(matchFrom[2]) - 1, Number(matchFrom[3]));
  const to = Date.UTC(Number(matchTo[1]), Number(matchTo[2]) - 1, Number(matchTo[3]));
  return Math.round((to - from) / 86_400_000);
}
