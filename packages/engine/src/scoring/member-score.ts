/**
 * Member-level scoring: aggregates every commitment's whole season into a
 * `MemberScore` (D1/D2). Wires `pause/pause-aware-week.ts`'s
 * `pauseAwareWeekSessions` into the live scoring pipeline for the first
 * time — every commitment, every week of the season, with
 * pause/proration/D8 (and, via `pauseAwareWeekSessions`'s own required
 * `options.season`, the D9 pause cap) already applied before
 * `scoring/commitment-score.ts` averages the result.
 *
 * R1's "so far" mid-season filtering (which weeks are closed enough to
 * count yet) is NOT applied here: every week of the season is aggregated,
 * matching a full end-of-season computation. Mid-season recompute (D12,
 * `today` before the season's end) is slice 6b's own edit to this file —
 * `weekSessionsOf`/`weeklyTotalResult`/`pauseAwareWeekSessions` are all
 * already documented as calendar-agnostic for exactly this reason.
 *
 * **WARNING (until slice 6b implements R1): `scoreMember` is an
 * end-of-season computation, NOT a "points so far" one.** Every week
 * `0..season.lengthWeeks-1` is always aggregated regardless of `input.today`
 * — a still-open or not-yet-graced week is scored exactly like a closed
 * one, using whatever entries happen to be in `input.entries` for it (zero
 * entries there today does not mean "not counted yet", it means "counted
 * as a miss"). Do not call this function to show a member their
 * mid-season/"so far" points until R1 gates the week loop in `seasonSessions`
 * below (slice 6b task 6b.2/6b.3) — doing so today would understate an
 * in-progress week as a full miss instead of excluding it.
 */
import type { Season, SeasonDay } from "../calendar/season-calendar";
import type { Commitment, CommitmentId } from "../commitment/commitment";
import type { Entry } from "../entry/entry";
import type { Fraction } from "../fraction/fraction";
import { div, fromInt, sum } from "../fraction/fraction";
import type { SessionResult } from "../opportunity/per-session";
import type { PauseRequest } from "../pause/pause";
import { pauseAwareWeekSessions } from "../pause/pause-aware-week";
import type { CommitmentScore } from "./commitment-score";
import { scorePerSessionCommitment } from "./commitment-score";

const DAYS_PER_WEEK = 7;
const TOTAL_POTENTIAL_POINTS = fromInt(1000);

export interface ScoreInput {
  readonly season: Season;
  readonly commitments: readonly Commitment[];
  readonly entries: readonly Entry[];
  readonly pauses: readonly PauseRequest[];
  /**
   * The snapshot day for pause resolution (an open pause is treated as
   * paused "as of today", D12) — NOT a "so far" cutoff for which weeks get
   * aggregated. Until slice 6b implements R1, `scoreMember` aggregates every
   * week of the season regardless of this value; see this file's own
   * top-of-file warning.
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

/**
 * Every `"scored"` session across the whole season for one commitment —
 * `"paused"`/`"onHold"` weeks contribute nothing at all (pause's neutral
 * effect, D8/E1), never a zero-progress placeholder.
 */
function seasonSessions(commitment: Commitment, input: ScoreInput): readonly SessionResult[] {
  const commitmentPauses = input.pauses.filter((pause) => pause.commitmentId === commitment.id);
  const sessions: SessionResult[] = [];
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
    if (result.status === "scored") sessions.push(...result.sessions);
  }
  return sessions;
}

/**
 * Aggregates every commitment's whole season into a `MemberScore` (D1/D2).
 * Points are never rounded here — only at display (`display/display.ts`,
 * slice 7).
 *
 * **Not yet R1-aware (see this file's top-of-file warning): until slice 6b,
 * this always computes over ALL weeks of the season and must NOT be used
 * to show "points so far" mid-season.**
 */
export function scoreMember(input: ScoreInput): MemberScore {
  let reachedTotal = 0;
  let opportunitiesTotal = 0;

  const commitments: readonly CommitmentScoreEntry[] = input.commitments.map((commitment) => {
    const sessions = seasonSessions(commitment, input);
    reachedTotal += sessions.filter((session) => session.consistent).length;
    opportunitiesTotal += sessions.length;
    const score = scorePerSessionCommitment(commitment.weightPercent, sessions);
    return { commitmentId: commitment.id, ...score };
  });

  const points = sum(commitments.map((commitment) => commitment.points));
  // R6: zero counted opportunities anywhere in the season -> null, not 0.
  const consistency =
    opportunitiesTotal === 0 ? null : div(fromInt(reachedTotal), fromInt(opportunitiesTotal));
  const idealCompletion = opportunitiesTotal === 0 ? null : div(points, TOTAL_POTENTIAL_POINTS);

  return { points, consistency, idealCompletion, commitments };
}
