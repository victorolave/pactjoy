import type { WeekProgress } from "@pactjoy/engine";

/** Every active opportunity of the commitment across the season, pause-aware: D12's denominator. */
export function activeOpportunities(weeks: number, weekAt: (week: number) => WeekProgress): number {
  let total = 0;
  for (let week = 0; week < weeks; week++) {
    const progress = weekAt(week);
    if (progress.status === "scored") total += progress.sessionsTarget;
  }
  return total;
}
