import type {
  CarryOverView,
  SeasonHistoryView,
  SeasonResultsView,
  SubmitSeasonClosureResult,
} from "@pactjoy/app";
import { presentMeasure } from "./season.ts";
import { presentInstant } from "./time.ts";

/**
 * Every field is emitted by name (ADR-0011): a field added to an app view is NOT served until it
 * is added here. All of these are the OWNER's own (ADR-0015): no member id appears in them, and
 * the routes carry none.
 */
export function presentSeasonResults(view: SeasonResultsView) {
  return {
    seasonId: view.seasonId,
    status: view.status,
    lengthWeeks: view.lengthWeeks,
    actualStart: view.actualStart,
    lastDay: view.lastDay,
    totals: {
      points: view.totals.points,
      consistencyPercent: view.totals.consistencyPercent,
      idealPercent: view.totals.idealPercent,
    },
    standings: {
      rank: view.standings.rank,
      memberCount: view.standings.memberCount,
      gap:
        view.standings.gap === null
          ? null
          : { displayName: view.standings.gap.displayName, points: view.standings.gap.points },
    },
    commitments: view.commitments.map((c) => ({
      commitmentId: c.commitmentId,
      habitId: c.habitId,
      habitName: c.habitName,
      icon: c.icon,
      points: c.points,
      consistencyPercent: c.consistencyPercent,
      idealPercent: c.idealPercent,
      automaticity: { from: c.automaticity.from, to: c.automaticity.to },
      stage: c.stage,
    })),
    closingReviewDone: view.closingReviewDone,
    closure:
      view.closure === null
        ? null
        : {
            decidedAt: presentInstant(view.closure.decidedAt),
            decisions: view.closure.decisions.map((d) => ({
              commitmentId: d.commitmentId,
              decision: d.decision,
            })),
          },
  };
}

export function presentSubmittedClosure(result: SubmitSeasonClosureResult) {
  return {
    decidedAt: presentInstant(result.closure.decidedAt),
    decisions: result.closure.decisions.map((d) => ({
      commitmentId: d.commitmentId,
      decision: d.decision,
    })),
    graduatedHabitIds: [...result.graduatedHabitIds],
    seasonClosed: result.seasonClosed,
  };
}

export function presentCarryOver(view: CarryOverView) {
  return {
    previousSeasonId: view.previousSeasonId,
    items: view.items.map((item) => ({
      habitId: item.habitId,
      decision: item.decision,
      previous: {
        measure: presentMeasure(item.previous.measure),
        weightPercent: item.previous.weightPercent,
        privacy: item.previous.privacy,
      },
    })),
  };
}

export function presentSeasonHistory(view: SeasonHistoryView) {
  return {
    seasons: view.seasons.map((s) => ({
      seasonId: s.seasonId,
      lengthWeeks: s.lengthWeeks,
      actualStart: s.actualStart,
      lastDay: s.lastDay,
      points: s.points,
      rank: s.rank,
      memberCount: s.memberCount,
      closedByMe: s.closedByMe,
    })),
  };
}
