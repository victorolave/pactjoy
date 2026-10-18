import type { MemberId } from "@pactjoy/engine";
import type { CircleId, UserId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { NoticeOutcome, OutboxNotice } from "./outbox-notice.ts";

/** What `reschedule` moves a claimed row to: back to `pending`, with a new window. */
export interface NoticeReschedule {
  readonly notBefore: Instant;
  readonly expiresAt: Instant;
  readonly rolloversLeft: 0 | 1;
  readonly attempts: number;
}

/**
 * Storage port of the notification outbox (ADR-0017). Confined to `src/notifications/`
 * (`notification-guard.test.ts`): other modules add notices through `enqueueNotices`.
 *
 * `claimDue` commits on its own; sending happens OUTSIDE any transaction (ADR-0010: no network
 * call inside `work`), and `finish`/`reschedule` are fenced by the state and the attempt count the
 * claim returned, so a dispatcher whose lease expired can never overwrite a newer claim.
 */
export interface NotificationOutboxRepository {
  /**
   * Adds the rows whose dedupe key is new, in `pending` with 0 attempts; existing keys are left as
   * they are (never an error). A relational adapter runs `INSERT ... ON CONFLICT DO NOTHING`.
   * @returns how many rows were added.
   */
  enqueue(notices: readonly OutboxNotice[]): Promise<number>;
  /**
   * Claims up to `limit` rows that are `pending` with `notBefore <= now`, or `sending` with a lease
   * at or before `now`, oldest `notBefore` first: each moves to `sending` with `leaseUntil` and one
   * more attempt. Concurrent claims take disjoint rows (`FOR UPDATE SKIP LOCKED` on Postgres).
   */
  claimDue(now: Instant, leaseUntil: Instant, limit: number): Promise<readonly OutboxNotice[]>;
  /**
   * Puts a claimed row back to `pending` with `next`, if it is still `sending` with
   * `claimedAttempts`. @returns false when the fence failed (nothing changed).
   */
  reschedule(dedupeKey: string, claimedAttempts: number, next: NoticeReschedule): Promise<boolean>;
  /**
   * Ends a claimed row, if it is still `sending` with `claimedAttempts`.
   * @returns false when the fence failed (nothing changed).
   */
  finish(
    dedupeKey: string,
    claimedAttempts: number,
    state: "sent" | "dropped" | "failed",
    outcome: NoticeOutcome,
    at: Instant,
  ): Promise<boolean>;
  /** Deletes up to `limit` final rows that finished before `finishedBefore`. @returns how many. */
  purgeFinished(finishedBefore: Instant, limit: number): Promise<number>;
  /**
   * Account erasure (ADR-0019): deletes every row addressed to the user (`recipientUserId`, the
   * ORIGINAL account id) or to any of `memberIds`, in ANY state (a claimed row included: its
   * fenced `finish` then simply changes nothing). `[]` still deletes by user. Idempotent.
   */
  deleteAddressedTo(userId: UserId, memberIds: readonly MemberId[]): Promise<void>;
  /**
   * Full-circle erasure: deletes every row of the circles, whatever its recipient or state. The
   * outbox has no foreign keys, so nothing cascades to it. `[]` is a no-op.
   */
  deleteByCircles(circleIds: readonly CircleId[]): Promise<void>;
}
