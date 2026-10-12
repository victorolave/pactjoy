import type { CommitmentId } from "@pactjoy/engine";
import { automaticityOf, comparableAutomaticity, type Fraction } from "@pactjoy/engine";
import type { AutomaticityResponse, ReviewRecord, SrbaiScore } from "./review.ts";

/** One commitment that feels more automatic than at its reference ("de 3,5 a 4,5", REQ-A7). */
export interface ReviewImprovement {
  readonly commitmentId: CommitmentId;
  /** The reference score, displayed ("3,5"). */
  readonly from: string;
  /** The new score, displayed ("4,5"). */
  readonly to: string;
}

/** The exact automaticity of one answer: the mean of the items that were answered. */
export function scoreOfResponse(response: AutomaticityResponse): Fraction {
  return automaticityOf(response.items.filter((item): item is SrbaiScore => item !== null));
}

/** True when the answer carries only item 1 (an interim review that asks the single question). */
const isItemOneOnly = (response: AutomaticityResponse): boolean =>
  response.items.slice(1).every((item) => item === null);

/**
 * The two scores to compare, like for like (owner decision, ADR-0014): when either side is
 * item-1-only, item 1 of both; when both are full, the means of the four items.
 */
function comparableScores(
  current: AutomaticityResponse,
  reference: AutomaticityResponse,
): { readonly current: Fraction; readonly reference: Fraction } {
  if (isItemOneOnly(current) || isItemOneOnly(reference)) {
    const first = (response: AutomaticityResponse): Fraction =>
      automaticityOf(
        response.items.slice(0, 1).filter((item): item is SrbaiScore => item !== null),
      );
    return { current: first(current), reference: first(reference) };
  }
  return { current: scoreOfResponse(current), reference: scoreOfResponse(reference) };
}

/**
 * What 35b names after a review is saved: only the commitments whose displayed automaticity went
 * UP against their reference, in the order of `current` (REQ-A7..A9). The reference is the
 * earliest earlier completed review that answered the commitment, which is the baseline when one
 * was taken (period 0 sorts first) and otherwise the first review score (SC-53). A commitment
 * with no reference has no comparison, and a skipped or lapsed baseline is simply absent.
 * The comparison is like for like (`comparableScores`): item 1 against item 1 when either side
 * is item-1-only, the four-item means when both are full.
 */
export function improvementsOf(
  current: readonly AutomaticityResponse[],
  earlier: readonly ReviewRecord[],
): readonly ReviewImprovement[] {
  const ordered = earlier
    .filter((review) => review.status === "completed")
    .sort((a, b) => a.periodIndex - b.periodIndex);
  return current.flatMap((response): ReviewImprovement[] => {
    for (const review of ordered) {
      const reference = review.responses.find((r) => r.commitmentId === response.commitmentId);
      if (reference === undefined) continue;
      const scores = comparableScores(response, reference);
      const { improved, from, to } = comparableAutomaticity(scores.current, scores.reference);
      return improved ? [{ commitmentId: response.commitmentId, from, to }] : [];
    }
    return [];
  });
}
