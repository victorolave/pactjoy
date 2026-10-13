import type { ProfileSummaryView } from "@pactjoy/app";

// Every field by name: a field added to the read model never reaches the wire by accident. The
// view is the caller's own and carries no other member's data (ADR-0011 Q23).
export function presentProfileSummary(view: ProfileSummaryView): ProfileSummaryView {
  return {
    consistency: {
      kept: view.consistency.kept,
      counted: view.consistency.counted,
      percent: view.consistency.percent,
      closedSeasons: view.consistency.closedSeasons,
      inProgress: view.consistency.inProgress,
    },
    habits: view.habits.map((habit) => ({
      habitId: habit.habitId,
      name: habit.name,
      icon: habit.icon,
      stage: habit.stage,
      inCurrentSeason: habit.inCurrentSeason,
    })),
  };
}
