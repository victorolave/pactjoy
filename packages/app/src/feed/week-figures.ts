import {
  type CommitmentWeeklySeries,
  commitmentWeeklySeries,
  type MemberId,
  type PeriodFigures,
  periodFigures,
  poolPeriodFigures,
  type SeasonDay,
  type WeekFigures,
} from "@pactjoy/engine";
import type { EntryRecord } from "../entry/entry.ts";
import type { EffectivePauseRequest } from "../pause/effective-pauses.ts";
import { toEnginePauses } from "../pause/to-engine.ts";
import { toScoreInput } from "../score/score-input.ts";
import type { Season } from "../season/season.ts";
import type { LocalDate } from "../time/local-date.ts";

export interface MemberWeeklySeriesArgs {
  readonly season: Season;
  readonly actualStart: LocalDate;
  readonly memberId: MemberId;
  readonly entries: readonly EntryRecord[];
  /** The season's requests with their effective decision (the pause choke point's output). */
  readonly requests: readonly EffectivePauseRequest[];
  /** The engine's "today" (0-based season day). */
  readonly today: SeasonDay;
}

/**
 * One member's season week by week, per commitment, from the engine's own walk (so a week here
 * can never disagree with the score or the review summary). Weeks are 0-BASED, like the engine's.
 * Empty for a member with no commitments in the season.
 */
export function memberWeeklySeries(
  args: MemberWeeklySeriesArgs,
): readonly CommitmentWeeklySeries[] {
  return commitmentWeeklySeries(
    toScoreInput({
      season: args.season,
      actualStart: args.actualStart,
      memberId: args.memberId,
      entries: args.entries,
      pauses: args.requests.flatMap(({ record, decision }) => toEnginePauses(record, decision)),
      today: args.today,
    }),
  );
}

/**
 * A "semana consistente" (ADR-0018, F5): the commitment's week is final (grace over), something
 * was counted, and every counted opportunity reached the minimum (or stayed within the
 * tolerance). Paused opportunities are not counted, so they neither help nor hurt.
 */
export function isConsistentWeek(
  figures: Pick<WeekFigures, "final" | "counted" | "kept">,
): boolean {
  return figures.final && figures.counted >= 1 && figures.kept === figures.counted;
}

/**
 * A "hard week" (owner decision, ADR-0018 F13): final, something counted, and fewer than half of
 * the counted opportunities were kept. Exact integers: `2 * kept < counted`, so exactly half is
 * NOT hard.
 */
export function isHardWeek(figures: Pick<PeriodFigures, "final" | "counted" | "kept">): boolean {
  return figures.final && figures.counted >= 1 && 2 * figures.kept < figures.counted;
}

/** The member's week `week` (0-based) pooled over their commitments, as the review pools a period. */
export function pooledWeek(series: readonly CommitmentWeeklySeries[], week: number): PeriodFigures {
  return poolPeriodFigures(series.map((entry) => periodFigures(entry.weeks, week, week)));
}

/**
 * The newest week (0-based) that is final for every commitment of the member, or `null` when none
 * is yet (or the member has no commitment). A nudge case lives on this week only (F13).
 */
export function latestFinalWeek(series: readonly CommitmentWeeklySeries[]): number | null {
  const weekCount = series[0]?.weeks.length ?? 0;
  for (let week = weekCount - 1; week >= 0; week--) {
    if (pooledWeek(series, week).final) return week;
  }
  return null;
}
