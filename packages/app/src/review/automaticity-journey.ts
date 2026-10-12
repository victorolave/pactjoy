import type { CommitmentId, MemberId } from "@pactjoy/engine";
import { comparableAutomaticity, displayAutomaticity } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import { comparableScores, scoreOfResponse } from "./improvements.ts";

/** How one commitment's automaticity moved over the season, displayed ("de 3,0 a 4,5"). */
export interface AutomaticityJourney {
  /** The start (the baseline, else the earliest earlier review); `null` when there is none. */
  readonly from: string | null;
  /** The closing review's score; `null` while the closing review is not completed. */
  readonly to: string | null;
}

/** Whether the member completed the season's closing review (it has no skip and never lapses). */
export async function closingReviewDone(
  repos: Pick<Repositories, "reviews">,
  season: Season,
  memberId: MemberId,
): Promise<boolean> {
  const stored = await repos.reviews.listMine(season.id, memberId);
  return stored.some((review) => review.kind === "closing" && review.status === "completed");
}

/**
 * The automaticity start and end of each of the member's commitments (screen 36), owner-only like
 * every review read. The start is the baseline when one was taken, else the earliest earlier
 * completed review that answered the commitment (as `improvementsOf`); the end is the closing
 * review. They are compared like for like (`comparableScores`): item 1 against item 1 when either
 * side is item-1-only, the four-item means when both are full. A commitment with no closing answer
 * has neither side; one with no earlier answer has only the end.
 */
export async function automaticityJourney(
  repos: Pick<Repositories, "reviews">,
  season: Season,
  memberId: MemberId,
): Promise<ReadonlyMap<CommitmentId, AutomaticityJourney>> {
  const stored = await repos.reviews.listMine(season.id, memberId);
  const closing = stored.find(
    (review) => review.kind === "closing" && review.status === "completed",
  );
  const earlier = stored
    .filter((review) => review.status === "completed" && review !== closing)
    .sort((a, b) => a.periodIndex - b.periodIndex);
  const journeys = new Map<CommitmentId, AutomaticityJourney>();
  for (const commitment of season.commitments) {
    if (commitment.memberId !== memberId) continue;
    const end = closing?.responses.find((r) => r.commitmentId === commitment.id);
    if (end === undefined) {
      journeys.set(commitment.id, { from: null, to: null });
      continue;
    }
    const reference = earlier
      .map((review) => review.responses.find((r) => r.commitmentId === commitment.id))
      .find((response) => response !== undefined);
    if (reference === undefined) {
      journeys.set(commitment.id, { from: null, to: displayAutomaticity(scoreOfResponse(end)) });
      continue;
    }
    const scores = comparableScores(end, reference);
    const { from, to } = comparableAutomaticity(scores.current, scores.reference);
    journeys.set(commitment.id, { from, to });
  }
  return journeys;
}
