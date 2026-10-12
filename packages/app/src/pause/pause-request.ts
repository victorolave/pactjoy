import type { CommitmentId, MemberId, PauseEnd, SeasonDay } from "@pactjoy/engine";
import type { PauseRequestId, SeasonId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";

export type { PauseEnd };

/** Why a member asks for a Pause (Pausa). Spanish copy lives only in the UI. */
export const PAUSE_REASONS = ["health", "travel", "work", "other"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

/** Lifecycle of a request; `cancelled` is a requester's withdrawal of a pending one (Q2). */
export type PauseStatus = "pending" | "approved" | "rejected" | "cancelled";

/** An approver's current answer; it can flip while the request is pending (Q3). */
export type PauseResponseChoice = "approve" | "reject";

/** Q4: a pending request with no rejection is approved this long after it was made. */
export const AUTO_APPROVE_AFTER_MS = 48 * 60 * 60 * 1000;

/** One Commitment covered by a request, with its own early resume (screen 29). */
export interface PauseRequestCommitment {
  readonly commitmentId: CommitmentId;
  readonly resumedOn: SeasonDay | null;
  readonly resumedAt: Instant | null;
}

/** One approver's current response. Only the latest per member is kept. */
export interface PauseResponse {
  readonly memberId: MemberId;
  readonly response: PauseResponseChoice;
  readonly respondedAt: Instant;
}

/**
 * The Pause request aggregate (ADR-0013): ONE decision and ONE version for
 * all the Commitments it covers ("Todos" is a single request). Its
 * `status`/`decidedAt`/`decidedOn` are what has been PERSISTED; the decision
 * a reader must act on is derived by `effectiveDecision`, because a pending
 * request turns approved at `autoApproveAt` with no job having run.
 * Invariant: `status === "pending"` exactly when `decidedAt === null`, and
 * `decidedAt === null` exactly when `decidedOn === null`.
 */
export interface PauseRequestRecord {
  readonly id: PauseRequestId;
  readonly seasonId: SeasonId;
  readonly memberId: MemberId;
  readonly reason: PauseReason;
  readonly note: string | null;
  readonly requestedAt: Instant;
  readonly requestedOn: SeasonDay;
  readonly startDay: SeasonDay;
  readonly end: PauseEnd;
  readonly autoApproveAt: Instant;
  readonly status: PauseStatus;
  readonly decidedAt: Instant | null;
  readonly decidedOn: SeasonDay | null;
  readonly commitments: readonly PauseRequestCommitment[];
  readonly responses: readonly PauseResponse[];
  readonly version: number;
}
