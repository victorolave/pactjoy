import type { MemberId } from "@pactjoy/engine";
import { activeMembers, type Circle } from "../../circle/circle.ts";
import type { Repositories } from "../../ports/repositories.ts";
import type { ReviewDay } from "../../review/review-schedule.ts";
import type { Season } from "../season.ts";
import { finalizeSeason, type MoveOnState, moveOnState } from "./move-on.ts";
import { seasonCloseCalendar } from "./season-calendar.ts";

/**
 * The members the season waits for before it can move on: ACTIVE members who hold at least one
 * Commitment of it. Members who left, and members with no Commitment (nothing to close), count as
 * done (decision C3).
 */
export function participantsOf(season: Season, circle: Circle): readonly MemberId[] {
  return activeMembers(circle)
    .filter((member) => season.commitments.some((commitment) => commitment.memberId === member.id))
    .map((member) => member.id);
}

/**
 * Whether the circle may move on from `season` on `day`. The closures are read (ids only) only once
 * the results day is reached; before it the answer is `blocked` whatever is stored. Reads never
 * write: a caller decides what to do with the answer.
 */
export async function moveOnFor(
  repos: Pick<Repositories, "seasonClosures">,
  season: Season,
  circle: Circle,
  day: ReviewDay,
): Promise<MoveOnState> {
  const { resultsFrom } = seasonCloseCalendar(season.lengthWeeks);
  if (day.kind === "beforeStart" || day.day < resultsFrom) {
    return moveOnState(season, [], [], day);
  }
  const closedIds = await repos.seasonClosures.closedMemberIds(season.id);
  return moveOnState(season, participantsOf(season, circle), closedIds, day);
}

export interface FinalizeResult {
  /** The season after the call: the closed one if it was finalized, otherwise unchanged. */
  readonly season: Season;
  readonly finalized: boolean;
}

/**
 * Writes `closed` onto an ACTIVE season when the circle may move on, in the caller's transaction
 * (there is no job, ADR-0013 style). `accept` says which answers finalize it: `complete` (the last
 * closer, or a leave that completes the set) or `completeOrStale` (the act of opening the next
 * season, which is what cuts laggards off). The save carries `expectedVersion: season.version`, so
 * a concurrent writer of the same season makes this transaction fail with a ConcurrencyConflict.
 */
export async function finalizeIfReady(
  repos: Pick<Repositories, "seasonClosures" | "seasons">,
  season: Season,
  circle: Circle,
  day: ReviewDay,
  accept: "complete" | "completeOrStale",
): Promise<FinalizeResult> {
  if (season.status !== "active") return { season, finalized: false };
  const state = await moveOnFor(repos, season, circle, day);
  const ready =
    state.kind === "complete" || (accept === "completeOrStale" && state.kind === "stale");
  if (!ready) return { season, finalized: false };
  const closed = finalizeSeason(season);
  await repos.seasons.save(closed, season.version);
  return { season: closed, finalized: true };
}
