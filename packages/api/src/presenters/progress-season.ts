import type { SeasonProgressView } from "@pactjoy/app";
import type { SeasonProgressDto } from "./progress.ts";
import { presentDetail } from "./progress-member.ts";

/**
 * Emits the SeasonProgressView wire DTO with an explicit field whitelist (ADR-0011).
 * Never exposes internals or unlisted properties.
 */
export function presentSeasonProgress(view: SeasonProgressView): SeasonProgressDto {
  if (view.state === "notStarted") {
    return { state: "notStarted", seasonId: view.seasonId };
  }

  const { id, timeZone, lengthWeeks, actualStart, lastDay } = view.season;
  const { today, weekIndex, dayOfWeek, daysLeft } = view.calendar;

  return {
    state: view.state,
    viewerId: view.viewerId,
    circle: { id: view.circle.id, name: view.circle.name },
    season: { id, timeZone, lengthWeeks, actualStart, lastDay },
    calendar: { today, weekIndex, dayOfWeek, daysLeft },
    own: {
      points: view.own.points,
      consistency: view.own.consistency,
      idealCompletion: view.own.idealCompletion,
      commitments: view.own.commitments.map(presentDetail),
    },
    standings: {
      memberCount: view.standings.memberCount,
      hasEntries: view.standings.hasEntries,
      rows: view.standings.rows.map((row) => ({
        memberId: row.memberId,
        displayName: row.displayName,
        isViewer: row.isViewer,
        rank: row.rank,
        points: row.points,
      })),
    },
    weeks: view.weeks.map((week) => ({
      weekIndex: week.weekIndex,
      start: week.start,
      end: week.end,
      timing: week.timing,
      facts: {
        counted: week.facts.counted,
        editable: week.facts.editable,
        final: week.facts.final,
      },
      members: week.members.map((m) => ({
        memberId: m.memberId,
        points: m.points,
        consistency: m.consistency,
        idealCompletion: m.idealCompletion,
      })),
    })),
  };
}
