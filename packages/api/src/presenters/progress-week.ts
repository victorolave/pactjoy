import type { WeekSummaryView } from "@pactjoy/app";
import type { WeekSummaryDto } from "./progress.ts";

/**
 * Emits the WeekSummaryView wire DTO with an explicit field whitelist (ADR-0011).
 * Never exposes internals or unlisted properties.
 */
export function presentWeekSummary(view: WeekSummaryView): WeekSummaryDto {
  const { id, timeZone, lengthWeeks, actualStart, lastDay } = view.season;
  const { counted, editable, final } = view.facts;

  return {
    weekIndex: view.weekIndex,
    start: view.start,
    end: view.end,
    timing: view.timing,
    facts: { counted, editable, final },
    points: view.points,
    consistency: view.consistency,
    idealCompletion: view.idealCompletion,
    viewerId: view.viewerId,
    season: { id, timeZone, lengthWeeks, actualStart, lastDay },
    headline: view.headline,
    weeksLeft: view.weeksLeft,
    commitments: view.commitments.map((c) => ({
      commitmentId: c.commitmentId,
      habit: { name: c.habit.name, icon: c.habit.icon },
      measure: c.measure,
      points: c.points,
      progress: c.progress
        ? {
            value: c.progress.value,
            target: c.progress.target,
            sessionsDone: c.progress.sessionsDone,
            sessionsTarget: c.progress.sessionsTarget,
            percent: c.progress.percent,
          }
        : null,
    })),
    circle: view.circle
      ? view.circle.map((m) => ({
          memberId: m.memberId,
          displayName: m.displayName,
          points: m.points,
        }))
      : null,
  };
}
