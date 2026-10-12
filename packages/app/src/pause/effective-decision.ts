import type { MemberId, SeasonDay } from "@pactjoy/engine";
import type { Instant } from "../time/instant.ts";
import type { PauseRequestRecord, PauseStatus } from "./pause-request.ts";

/** What a reader must act on at a given instant, derived from the persisted record. */
export type EffectiveDecision =
  | { readonly status: "pending" }
  | {
      readonly status: Exclude<PauseStatus, "pending">;
      readonly decidedAt: Instant;
      readonly decidedOn: SeasonDay;
    };

export interface DecisionContext {
  /** Active members of the circle other than the requester: the people whose answer is needed. */
  readonly approverIds: readonly MemberId[];
  readonly now: Instant;
  /** The season-timezone day an instant falls on (the only place real time becomes a `SeasonDay`). */
  readonly dayOf: (at: Instant) => SeasonDay;
}

/**
 * The lazy decision of a Pause request (ADR-0013, D3), pure and total:
 *
 * 1. A persisted decision (approved, rejected, cancelled) wins: decisions are final (Q3).
 * 2. Nobody can approve: approved at `requestedAt` (Q1).
 * 3. Every approver has a current response: all approve means approved, any
 *    reject means rejected, at the latest response instant.
 * 4. `now >= autoApproveAt`: a standing reject means rejected, otherwise
 *    approved (Q4), at `autoApproveAt` itself.
 * 5. Otherwise pending.
 *
 * `decidedOn` is the season-timezone day of `decidedAt`, so an auto decision
 * reports the day of the deadline, NEVER the day of the read that noticed it
 * (PL-13). Responses of anyone who is not currently an approver are ignored.
 */
export function effectiveDecision(
  record: PauseRequestRecord,
  context: DecisionContext,
): EffectiveDecision {
  if (record.status !== "pending") {
    if (record.decidedAt === null || record.decidedOn === null) {
      throw new Error(`pause request ${record.id} is ${record.status} without a decision`);
    }
    return { status: record.status, decidedAt: record.decidedAt, decidedOn: record.decidedOn };
  }

  const decideAt = (status: "approved" | "rejected", at: Instant): EffectiveDecision => ({
    status,
    decidedAt: at,
    decidedOn: context.dayOf(at),
  });

  if (context.approverIds.length === 0) return decideAt("approved", record.requestedAt);

  const current = record.responses.filter((r) => context.approverIds.includes(r.memberId));
  const rejected = current.some((r) => r.response === "reject");
  const everyoneAnswered = context.approverIds.every((id) =>
    current.some((r) => r.memberId === id),
  );
  if (everyoneAnswered) {
    const latest = current.reduce<Instant>(
      (at, r) => (r.respondedAt > at ? r.respondedAt : at),
      record.requestedAt,
    );
    return decideAt(rejected ? "rejected" : "approved", latest);
  }

  if (context.now >= record.autoApproveAt) {
    return decideAt(rejected ? "rejected" : "approved", record.autoApproveAt);
  }
  return { status: "pending" };
}
