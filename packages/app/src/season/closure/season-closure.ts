import type { CommitmentId, MemberId } from "@pactjoy/engine";
import type { SeasonClosureId, SeasonId } from "../../shared/ids.ts";
import type { Instant } from "../../time/instant.ts";

/**
 * What a member decides for ONE of their Commitments when the season closes:
 * keep it as is, adjust it, leave it out of the next season ("Pausar", which is
 * NOT an A2 Pause) or graduate the habit for good.
 */
export type ClosureDecision = "continue" | "adjust" | "pause" | "graduate";

export const CLOSURE_DECISIONS: readonly ClosureDecision[] = [
  "continue",
  "adjust",
  "pause",
  "graduate",
];

export function isClosureDecision(value: unknown): value is ClosureDecision {
  return CLOSURE_DECISIONS.includes(value as ClosureDecision);
}

/** One decision, keyed by the Commitment it is about (the closure covers every own Commitment). */
export interface CommitmentClosureDecision {
  readonly commitmentId: CommitmentId;
  readonly decision: ClosureDecision;
}

/**
 * The SeasonClosure aggregate (Cierre de temporada): what ONE member decided about
 * each of their Commitments, identified by `(seasonId, memberId)`. It is inserted
 * once and final, so `version` stays 0. Decisions are private to their owner; only
 * the EXISTENCE of a closure is visible to the lifecycle rule (`closedMemberIds`).
 * Points, standings and Entries are never touched by it.
 */
export interface SeasonClosure {
  readonly id: SeasonClosureId;
  readonly seasonId: SeasonId;
  readonly memberId: MemberId;
  readonly decisions: readonly CommitmentClosureDecision[];
  readonly decidedAt: Instant;
  readonly version: number;
}
