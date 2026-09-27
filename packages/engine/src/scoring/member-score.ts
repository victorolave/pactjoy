/**
 * Member-level scoring: aggregates every commitment's whole season into a
 * `MemberScore` (D1/D2/D12). Wires `pause/pause-aware-week.ts`'s
 * `pauseAwareWeekSessions` into the live scoring pipeline — every
 * commitment, every week of the season, with pause/proration/D8 (and the D9
 * pause cap) already applied — and, since slice 6b, gates which of those
 * opportunities are already "counted so far" (R1) before handing both sets
 * to `scoring/commitment-score.ts`'s `scoreCommitmentSoFar`.
 *
 * **R1 (`sdd/scoring-engine/design-decisions`, round 2)**: a day-bound
 * opportunity (`specificDays`) counts once it has an entry (done or missed)
 * OR once its own grace deadline has passed. A week-bound opportunity
 * (`weeklyTotal`, or any of a `timesPerWeek` week's best-N sessions) counts
 * only once the WHOLE week closes plus its grace period — an in-progress
 * week's partial entries never leak into the aggregate early (Mecanicas:
 * "evitar que una semana en curso hunda los puntos visibles"). This file is
 * the R1 gate's only home: `weekSessionsOf`/`weeklyTotalResult`/
 * `pauseAwareWeekSessions` all stay calendar-agnostic on purpose, exactly as
 * documented since slice 4.
 *
 * **D12 mid-season recompute** falls out of R1 plus
 * `scoreCommitmentSoFar`'s own two-list design: `allSessions` (this file's
 * existing whole-season, pause-aware computation, unconditioned by R1) is
 * `points`'s own denominator ("oportunidades activas de la temporada"); the
 * R1-gated `soFarSessions` subset drives every numerator. At season end
 * (`today` at/after every week's own grace deadline) the two sets coincide,
 * reproducing the exact prior end-of-season values.
 *
 * **R7 (decision round 4, binding)**: unlike `points`, mid-season
 * `consistency`/`idealCompletion` (both per-commitment and member-level) are
 * computed ONLY over `soFarSessions` — see `scoring/commitment-score.ts`'s
 * and this file's own `scoreMember` doc comments for the exact formulas.
 * `idealCompletion = points / potential` only holds at season end.
 */
import type { Season, SeasonDay } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import type { Commitment, CommitmentId } from "../commitment/commitment";
import type { Entry } from "../entry/entry";
import { graceDeadline } from "../entry/grace-period";
import type { Fraction } from "../fraction/fraction";
import { add, div, fromInt, mul, sum } from "../fraction/fraction";
import type { SessionResult } from "../opportunity/per-session";
import { dayForWeekday } from "../opportunity/per-session";
import type { PauseRequest } from "../pause/pause";
import {
  excludedDays,
  pauseAwareWeekSessions,
  rejectionExtendedDeadline,
} from "../pause/pause-aware-week";
import type { CommitmentScore } from "./commitment-score";
import { scoreCommitmentSoFar } from "./commitment-score";
import type { Streak, StreakOutcome, StreakUnit } from "./streak";
import { computeStreak, dayStreakOutcome, weekStreakOutcome } from "./streak";

const DAYS_PER_WEEK = 7;

export interface ScoreInput {
  readonly season: Season;
  readonly commitments: readonly Commitment[];
  readonly entries: readonly Entry[];
  readonly pauses: readonly PauseRequest[];
  /**
   * The snapshot day: both for pause resolution (an open pause is treated
   * as paused "as of today", D12) AND, since slice 6b, as R1's "so far"
   * cutoff — which of the season's opportunities are already counted.
   */
  readonly today: SeasonDay;
}

export interface CommitmentScoreEntry extends CommitmentScore {
  readonly commitmentId: CommitmentId;
  /** D11, wired into production since the fresh-review fix: current/best streak, R1- and pause-aware. */
  readonly streak: Streak;
}

export interface MemberScore {
  /** D12: redistributes over the whole season's active opportunities — unaffected by R7. */
  readonly points: Fraction;
  /** D2/R7: Sigma(reached)/Sigma(counted-so-far) across every commitment — not an average of per-commitment ratios, and NOT divided by the season's total opportunity count mid-season. `null` with zero counted opportunities anywhere (R6). */
  readonly consistency: Fraction | null;
  /** D2/R8: `null` while ANY commitment still has zero counted opportunities (not just when nothing at all has been counted, per R6) — see `scoreMember`'s own doc comment. Once every commitment has something counted, the weight-weighted average of each commitment's own idealCompletion, no renormalization. Equals `points / 1000` only at season end. */
  readonly idealCompletion: Fraction | null;
  readonly commitments: readonly CommitmentScoreEntry[];
}

/** `entries` already scoped to one commitment; this narrows further to one week, by `entry.day` (the same contract `pauseAwareWeekSessions`'s own callers must honor). */
function entriesForWeek(
  entries: readonly Entry[],
  commitmentId: CommitmentId,
  week: number,
): readonly Entry[] {
  const weekStart = week * DAYS_PER_WEEK;
  const weekEnd = weekStart + DAYS_PER_WEEK - 1;
  return entries.filter(
    (entry) =>
      entry.commitmentId === commitmentId && entry.day >= weekStart && entry.day <= weekEnd,
  );
}

/** Whether `commitment`'s own opportunities are week-bound (R1): `weeklyTotal`, or a `timesPerWeek` week's best-N sessions. `specificDays` is the only day-bound kind. */
function isWeekBound(commitment: Commitment): boolean {
  if (commitment.schedule.period === "weeklyTotal") return true;
  return commitment.schedule.frequency.kind === "timesPerWeek";
}

/** The `specificDays` scheduled days of `commitment`'s `week`, UNFILTERED (every scheduled day, whether or not it ends up excluded) — the caller decides per-day exclusion itself, once, against a single shared exclusion set (fresh-review nit: no second, independent exclusion computation). Empty for any other schedule kind. */
function specificDaysScheduledDays(
  commitment: Commitment,
  season: Season,
  week: number,
): readonly SeasonDay[] {
  if (commitment.schedule.period === "weeklyTotal") return [];
  const { frequency } = commitment.schedule;
  if (frequency.kind !== "specificDays") return [];
  return frequency.weekdays.map((weekday) => dayForWeekday(season, week, weekday));
}

/**
 * R1's week-bound counting deadline (SHOULD-FIX): the plain
 * `graceDeadline(weekEnd)` ignores a rejection's grace extension
 * (`rejectionExtendedDeadline`, `pause/pause-aware-week.ts`), which can push
 * a specific day's own deadline past `weekEnd + 1`. The week counts only
 * once `today` reaches the MAX of every day's own (possibly extended)
 * deadline — for `weeklyTotal` that's a single whole-week range; for
 * `timesPerWeek`, since any of its 7 calendar days could be the one a
 * rejection affects, every day is checked individually and the latest wins.
 * Reuses `rejectionExtendedDeadline` itself rather than duplicating its
 * formula.
 */
function weekBoundGraceDeadline(
  commitment: Commitment,
  pauses: readonly PauseRequest[],
  week: number,
): SeasonDay {
  const weekStart = week * DAYS_PER_WEEK;
  const weekEnd = seasonDay(weekStart + (DAYS_PER_WEEK - 1));
  if (commitment.schedule.period === "weeklyTotal") {
    return rejectionExtendedDeadline(pauses, weekStart, weekEnd, graceDeadline(weekEnd));
  }
  let latest = rejectionExtendedDeadline(
    pauses,
    weekStart,
    weekStart,
    graceDeadline(seasonDay(weekStart)),
  );
  for (let offset = 1; offset < DAYS_PER_WEEK; offset++) {
    const day = weekStart + offset;
    const dayDeadline = rejectionExtendedDeadline(pauses, day, day, graceDeadline(seasonDay(day)));
    if (dayDeadline > latest) latest = dayDeadline;
  }
  return latest;
}

interface SeasonSessions {
  /** Every "scored" session across the whole season (D12's denominator) — unconditioned by R1. */
  readonly all: readonly SessionResult[];
  /** The R1-gated subset of `all` already "counted so far" as of `input.today` (D12's numerator). */
  readonly soFar: readonly SessionResult[];
  /** D11, R1- and pause-aware: `"frozen"` for every paused/on-hold or not-yet-counted opportunity, `"kept"`/`"broken"` otherwise. */
  readonly streak: Streak;
}

/**
 * Every `"scored"` session across the whole season for one commitment —
 * `"paused"`/`"onHold"` weeks contribute nothing at all (pause's neutral
 * effect, D8/E1), never a zero-progress placeholder — split into `all`
 * (D12's denominator), `soFar` (R1's "so far" subset, D12's numerator) and
 * `streak` (D11, folded from the same walk: excluded or not-yet-counted
 * opportunities freeze it, exactly like they contribute nothing to `soFar`).
 */
function seasonSessions(commitment: Commitment, input: ScoreInput): SeasonSessions {
  const commitmentPauses = input.pauses.filter((pause) => pause.commitmentId === commitment.id);
  const weekBound = isWeekBound(commitment);
  // Hoisted out of the week loop (fresh-review nit): doesn't depend on `week`, only on `pauses`/
  // `today`/`season`, all fixed for this commitment across the whole season.
  const excluded = excludedDays(commitmentPauses, input.today, { season: input.season });
  const all: SessionResult[] = [];
  const soFar: SessionResult[] = [];
  const streakOutcomes: StreakOutcome[] = [];

  for (let week = 0; week < input.season.lengthWeeks; week++) {
    const weekEntries = entriesForWeek(input.entries, commitment.id, week);
    const result = pauseAwareWeekSessions(
      commitment,
      week,
      commitmentPauses,
      weekEntries,
      input.today,
      { season: input.season },
    );

    if (weekBound) {
      if (result.status !== "scored") {
        streakOutcomes.push("frozen");
        continue;
      }
      all.push(...result.sessions);
      // R1 (SHOULD-FIX): the rejection-extension-aware deadline, not the plain graceDeadline(weekEnd).
      const counted = input.today >= weekBoundGraceDeadline(commitment, commitmentPauses, week);
      if (counted) soFar.push(...result.sessions);
      streakOutcomes.push(counted ? weekStreakOutcome(false, result.sessions) : "frozen");
      continue;
    }

    // specificDays: day-bound — R1 and D11 both gate/fold per scheduled day.
    const scheduledDays = specificDaysScheduledDays(commitment, input.season, week);
    if (result.status !== "scored") {
      for (const _day of scheduledDays) streakOutcomes.push("frozen");
      continue;
    }
    all.push(...result.sessions);
    let activeIndex = 0;
    for (const day of scheduledDays) {
      if (excluded.has(day)) {
        streakOutcomes.push("frozen");
        continue;
      }
      const session = result.sessions[activeIndex];
      activeIndex++;
      if (session === undefined) continue;
      // R1 (SHOULD-FIX): the rejection-extension-aware deadline for this specific day.
      const dayDeadline = rejectionExtendedDeadline(commitmentPauses, day, day, graceDeadline(day));
      // R1: counts once it has an entry (value !== null covers "done" and explicit "missed")
      // OR once its own (possibly extended) grace deadline has passed.
      const counted = session.value !== null || input.today >= dayDeadline;
      if (counted) soFar.push(session);
      streakOutcomes.push(counted ? dayStreakOutcome(false, session) : "frozen");
    }
  }

  const streakUnit: StreakUnit = weekBound ? "week" : "day";
  return { all, soFar, streak: computeStreak(streakUnit, streakOutcomes) };
}

/**
 * Aggregates every commitment's whole season into a `MemberScore`
 * (D1/D2/D12), R1-aware since slice 6b. Points are never rounded here —
 * only at display (`display/display.ts`, slice 7).
 *
 * **R7 (decision round 4, binding)**: member `points` keeps D12's
 * whole-season redistribution unchanged. Member `consistency` pools
 * `reached`/`counted-so-far` across every commitment (D2's own
 * "sobre el total de oportunidades" pattern, now over what's been counted,
 * not the whole season).
 *
 * **R8 (decision round 5, binding — supersedes R7's original renormalized
 * idealCompletion)**: member `idealCompletion` is `null` while ANY
 * commitment still has zero counted opportunities (its own `idealCompletion`
 * is `null`), even if every OTHER commitment already has a real value —
 * the user explicitly rejected renormalizing over only the
 * already-counted commitments. Only once EVERY commitment has at least one
 * counted opportunity does it become the weight-weighted AVERAGE of each
 * commitment's own `idealCompletion` — and since every commitment is
 * included at that point, the weights already sum to 100 and no
 * renormalization is needed. At season end (every commitment always has
 * something counted) this is provably identical to the pre-R7
 * `points / 1000` formula: `idealCompletion_i = points_i / potential_i`
 * there, so `Sigma(weight_i x idealCompletion_i) / 100 = Sigma(points_i) /
 * 1000 = totalPoints / 1000` exactly.
 */
export function scoreMember(input: ScoreInput): MemberScore {
  let reachedTotal = 0;
  let soFarTotal = 0; // Sigma(soFar) -- R7's pooled consistency denominator, and the R6 gate.
  let anyCommitmentUncounted = false; // R8: true if any commitment's own idealCompletion is null.
  let idealCompletionWeightSum = 0; // Sigma(weight_i) -- once nothing is uncounted, this is every commitment's weight.
  let idealCompletionNumerator = fromInt(0); // Sigma(weight_i x idealCompletion_i).

  const commitments: readonly CommitmentScoreEntry[] = input.commitments.map((commitment) => {
    const { all, soFar, streak } = seasonSessions(commitment, input);
    reachedTotal += soFar.filter((session) => session.consistent).length;
    soFarTotal += soFar.length;
    const score = scoreCommitmentSoFar(commitment.weightPercent, all, soFar);
    if (score.idealCompletion === null) {
      anyCommitmentUncounted = true;
    } else {
      idealCompletionWeightSum += commitment.weightPercent;
      idealCompletionNumerator = add(
        idealCompletionNumerator,
        mul(fromInt(commitment.weightPercent), score.idealCompletion),
      );
    }
    return { commitmentId: commitment.id, ...score, streak };
  });

  const points = sum(commitments.map((commitment) => commitment.points));
  // R6: nothing counted so far anywhere (zero opportunities, or every one still paused/on-hold/
  // within grace without an entry) -> null, not 0.
  const consistency = soFarTotal === 0 ? null : div(fromInt(reachedTotal), fromInt(soFarTotal));
  // R8: null while ANY commitment is uncounted (not just when nothing at all is counted) --
  // NEVER renormalize over only the counted subset. Once nothing is uncounted, divide by the
  // actual weight sum present (100 for a real pact, whose weights always sum to 100) -- the exact
  // same division the pre-R8 formula already did in this "everything counted" branch.
  const idealCompletion =
    input.commitments.length === 0 || anyCommitmentUncounted
      ? null
      : div(idealCompletionNumerator, fromInt(idealCompletionWeightSum));

  return { points, consistency, idealCompletion, commitments };
}
