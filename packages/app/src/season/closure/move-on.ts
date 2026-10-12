import type { MemberId } from "@pactjoy/engine";
import type { ReviewDay } from "../../review/review-schedule.ts";
import type { Season } from "../season.ts";
import { seasonCloseCalendar } from "./season-calendar.ts";

/**
 * Whether the circle may move on from an ended season (decision C5), a pure rule:
 * - `complete`: results are open and every participant has closed;
 * - `stale`: seven full days after the last season day, so the circle may open its next season
 *   without the members who have not closed (they are cut off only by that act);
 * - `blocked`: neither yet. Carries the two calendar days so a caller can say when.
 * `complete` wins over `stale` when both hold.
 */
export type MoveOnState =
  | { readonly kind: "complete" }
  | { readonly kind: "stale" }
  | { readonly kind: "blocked"; readonly resultsFrom: number; readonly staleFrom: number };

/**
 * `participants` are the ACTIVE members who hold at least one Commitment of the season; `closedIds`
 * are the members who submitted a closure (ids only: decisions never leave their owner). A closure
 * by someone who is not a participant is ignored. With no participants there is nobody to wait for.
 */
export function moveOnState(
  season: Pick<Season, "lengthWeeks">,
  participants: readonly MemberId[],
  closedIds: readonly MemberId[],
  day: ReviewDay,
): MoveOnState {
  const { resultsFrom, staleFrom } = seasonCloseCalendar(season.lengthWeeks);
  if (day.kind === "day") {
    const closed = new Set<MemberId>(closedIds);
    if (day.day >= resultsFrom && participants.every((id) => closed.has(id))) {
      return { kind: "complete" };
    }
    if (day.day >= staleFrom) return { kind: "stale" };
  }
  return { kind: "blocked", resultsFrom, staleFrom };
}

/**
 * The finalized season: `closed`, with its version bumped. Pure, and idempotent on a season that is
 * already closed (REQ-F13): it returns it unchanged.
 */
export function finalizeSeason(season: Season): Season {
  if (season.status === "closed") return season;
  return { ...season, status: "closed", version: season.version + 1 };
}
