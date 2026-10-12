import type { PauseDecision } from "@pactjoy/engine";
import type { EffectiveDecision } from "./effective-decision.ts";
import type { MemberPauseRequest } from "./pause-request.repository.ts";
import type { PauseRequestRecord } from "./pause-request.ts";

/**
 * Maps a request and its effective decision to the engine's input: ONE
 * engine `PauseRequest` per Commitment (E21), each with the owner so the
 * score input can filter by member. Expansion happens only here.
 *
 * - `cancelled` maps to `rejected{decidedOn = cancel day}` (Q2): scoring and
 *   grace treat a cancel exactly like a rejection.
 * - Q6: resuming a pause that has not started only sets `resumedOn = today`
 *   on an `approved` request; the engine then yields no paused days at all,
 *   so no special case is needed here.
 */
export function toEnginePauses(
  record: PauseRequestRecord,
  decision: EffectiveDecision,
): readonly MemberPauseRequest[] {
  return record.commitments.map((item) => ({
    memberId: record.memberId,
    commitmentId: item.commitmentId,
    requestedOn: record.requestedOn,
    startDay: record.startDay,
    end: record.end,
    decision: engineDecision(decision, item.resumedOn),
  }));
}

function engineDecision(
  decision: EffectiveDecision,
  resumedOn: PauseRequestRecord["commitments"][number]["resumedOn"],
): PauseDecision {
  switch (decision.status) {
    case "pending":
      return { kind: "pending" };
    case "approved":
      return { kind: "approved", decidedOn: decision.decidedOn, resumedOn };
    case "rejected":
    case "cancelled":
      return { kind: "rejected", decidedOn: decision.decidedOn };
  }
}
