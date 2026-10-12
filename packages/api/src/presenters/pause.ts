import type {
  MyPauseRequestsView,
  PauseApprovalView,
  PauseCommitmentApprovalView,
  PauseRequestView,
} from "@pactjoy/app";
import { presentInstant, presentInstantOrNull } from "./time.ts";

/**
 * Every field is emitted by name (ADR-0011): a field added to an app view is NOT served until it is
 * added here, and `userId` is never among them. A private Commitment is exactly
 * `{kind: "hidden", commitmentId}` (Q15), built by name so nothing else can ride along.
 */
export function presentPauseRequest(view: PauseRequestView) {
  return {
    id: view.id,
    status: view.status,
    reason: view.reason,
    note: view.note,
    startDate: view.startDate,
    endDate: view.endDate,
    requestedAt: presentInstant(view.requestedAt),
    autoApproveAt: presentInstant(view.autoApproveAt),
    decidedAt: presentInstantOrNull(view.decidedAt),
    commitments: view.commitments.map((c) => ({
      commitmentId: c.commitmentId,
      habitName: c.habitName,
      icon: c.icon,
      resumedOn: c.resumedOn,
    })),
    approvers: view.approvers.map((a) => ({
      memberId: a.memberId,
      displayName: a.displayName,
      response: a.response,
    })),
  };
}

function presentApprovalCommitment(c: PauseCommitmentApprovalView) {
  return c.kind === "hidden"
    ? { kind: "hidden" as const, commitmentId: c.commitmentId }
    : {
        kind: "visible" as const,
        commitmentId: c.commitmentId,
        habitName: c.habitName,
        icon: c.icon,
      };
}

export function presentPauseApproval(view: PauseApprovalView) {
  return {
    id: view.id,
    status: view.status,
    reason: view.reason,
    note: view.note,
    startDate: view.startDate,
    endDate: view.endDate,
    requestedAt: presentInstant(view.requestedAt),
    autoApproveAt: presentInstant(view.autoApproveAt),
    requester: {
      memberId: view.requester.memberId,
      displayName: view.requester.displayName,
    },
    myResponse: view.myResponse,
    commitments: view.commitments.map(presentApprovalCommitment),
  };
}

export function presentMyPauseRequests(
  view: MyPauseRequestsView,
  mine: readonly PauseRequestView[],
  awaitingMe: readonly PauseApprovalView[],
) {
  return {
    seasonId: view.seasonId,
    mine: mine.map(presentPauseRequest),
    awaitingMe: awaitingMe.map(presentPauseApproval),
    budgets: view.budgets.map((b) => ({
      commitmentId: b.commitmentId,
      cap: b.cap,
      usedDays: b.usedDays,
      remainingDays: b.remainingDays,
    })),
    redistributed:
      view.redistributed === null
        ? null
        : {
            pauseRequestId: view.redistributed.pauseRequestId,
            total: {
              before: view.redistributed.total.before,
              after: view.redistributed.total.after,
            },
            commitments: view.redistributed.commitments.map((c) => ({
              commitmentId: c.commitmentId,
              before: c.before,
              after: c.after,
              weightPoints: c.weightPoints,
              opportunities: { before: c.opportunities.before, after: c.opportunities.after },
            })),
          },
    resumePreviews: view.resumePreviews.map((p) => ({
      pauseRequestId: p.pauseRequestId,
      commitmentId: p.commitmentId,
      weekOpportunities: p.weekOpportunities,
    })),
  };
}
