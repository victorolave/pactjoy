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
 * `scoreCommitmentSoFar`'s own two-list design with NO separate formula:
 * `allSessions` (this file's existing whole-season, pause-aware
 * computation, unconditioned by R1) is the denominator ("oportunidades
 * activas de la temporada"); the R1-gated `soFarSessions` subset drives the
 * numerator. At season end (`today` at/after every week's own grace
 * deadline) the two sets coincide, reproducing the exact prior end-of-season
 * values.
 */
import type { Season, SeasonDay } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import type { Commitment, CommitmentId } from "../commitment/commitment";
import type { Entry } from "../entry/entry";
import { graceDeadline } from "../entry/grace-period";
import type { Fraction } from "../fraction/fraction";
import { div, fromInt, sum } from "../fraction/fraction";
import { dayForWeekday } from "../opportunity/per-session";
import type { SessionResult } from "../opportunity/per-session";
import type { PauseRequest } from "../pause/pause";
import { excludedDays, pauseAwareWeekSessions } from "../pause/pause-aware-week";
import type { CommitmentScore } from "./commitment-score";
import { scoreCommitmentSoFar } from "./commitment-score";

const DAYS_PER_WEEK = 7;
const TOTAL_POTENTIAL_POINTS = fromInt(1000);

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
}

export interface MemberScore {
  readonly points: Fraction;
  /** D2: Sigma(reached)/Sigma(opportunities) across every commitment — not an average of per-commitment ratios. `null` with zero counted opportunities anywhere (R6). */
  readonly consistency: Fraction | null;
  /** D2: totalPoints / 1000. `null` with zero counted opportunities anywhere (R6) — not `0`. */
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

/** The `specificDays` scheduled days of `commitment`'s `week`, excluding any paused/on-hold day (P-A) — in the SAME order `pauseAwareWeekSessions` itself filters them, so it lines up 1:1 with that week's returned `sessions`. Empty for any other schedule kind. */
function specificDaysActiveDays(
  commitment: Commitment,
  season: Season,
  week: number,
  excluded: ReadonlySet<SeasonDay>,
): readonly SeasonDay[] {
  if (commitment.schedule.period === "weeklyTotal") return [];
  const { frequency } = commitment.schedule;
  if (frequency.kind !== "specificDays") return [];
  return frequency.weekdays
    .map((weekday) => dayForWeekday(season, week, weekday))
    .filter((day) => !excluded.has(day));
}

interface SeasonSessions {
  /** Every "scored" session across the whole season (D12's denominator) — unconditioned by R1. */
  readonly all: readonly SessionResult[];
  /** The R1-gated subset of `all` already "counted so far" as of `input.today` (D12's numerator). */
  readonly soFar: readonly SessionResult[];
}

/**
 * Every `"scored"` session across the whole season for one commitment —
 * `"paused"`/`"onHold"` weeks contribute nothing at all (pause's neutral
 * effect, D8/E1), never a zero-progress placeholder — split into `all`
 * (D12's denominator) and `soFar` (R1's "so far" subset, D12's numerator).
 */
function seasonSessions(commitment: Commitment, input: ScoreInput): SeasonSessions {
  const commitmentPauses = input.pauses.filter((pause) => pause.commitmentId === commitment.id);
  const weekBound = isWeekBound(commitment);
  const all: SessionResult[] = [];
  const soFar: SessionResult[] = [];

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
    if (result.status !== "scored") continue;
    all.push(...result.sessions);

    if (weekBound) {
      // R1: the whole week counts only once it closes plus its own grace period.
      const weekEnd = seasonDay(week * DAYS_PER_WEEK + (DAYS_PER_WEEK - 1));
      if (input.today >= graceDeadline(weekEnd)) soFar.push(...result.sessions);
      continue;
    }

    // specificDays: R1 gates each scheduled day independently.
    const excluded = excludedDays(commitmentPauses, input.today, { season: input.season });
    const activeDays = specificDaysActiveDays(commitment, input.season, week, excluded);
    for (let i = 0; i < result.sessions.length; i++) {
      const session = result.sessions[i];
      const day = activeDays[i];
      if (session === undefined || day === undefined) continue;
      // R1: counts once it has an entry (value !== null covers "done" and explicit "missed")
      // OR once its own grace deadline has passed.
      if (session.value !== null || input.today >= graceDeadline(day)) soFar.push(session);
    }
  }
  return { all, soFar };
}

/**
 * Aggregates every commitment's whole season into a `MemberScore`
 * (D1/D2/D12), R1-aware since slice 6b. Points are never rounded here —
 * only at display (`display/display.ts`, slice 7).
 */
export function scoreMember(input: ScoreInput): MemberScore {
  let reachedTotal = 0;
  let opportunitiesTotal = 0; // Sigma(all) -- D12's denominator across every commitment.
  let soFarTotal = 0; // Sigma(soFar) -- gates R6 (nothing counted anywhere yet).

  const commitments: readonly CommitmentScoreEntry[] = input.commitments.map((commitment) => {
    const { all, soFar } = seasonSessions(commitment, input);
    reachedTotal += soFar.filter((session) => session.consistent).length;
    opportunitiesTotal += all.length;
    soFarTotal += soFar.length;
    const score = scoreCommitmentSoFar(commitment.weightPercent, all, soFar);
    return { commitmentId: commitment.id, ...score };
  });

  const points = sum(commitments.map((commitment) => commitment.points));
  // R6: nothing counted so far anywhere (zero opportunities, or every one still paused/on-hold/
  // within grace without an entry) -> null, not 0.
  const consistency =
    soFarTotal === 0 ? null : div(fromInt(reachedTotal), fromInt(opportunitiesTotal));
  const idealCompletion = soFarTotal === 0 ? null : div(points, TOTAL_POTENTIAL_POINTS);

  return { points, consistency, idealCompletion, commitments };
}
