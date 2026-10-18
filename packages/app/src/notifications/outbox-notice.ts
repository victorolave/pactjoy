import type { MemberId } from "@pactjoy/engine";
import type { CircleId, SeasonId, UserId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { TimeZoneId } from "../time/time-zone.port.ts";
import type { NoticeContent } from "./notification-kind.ts";

/** Where a notice is in its life. `sent`, `dropped` and `failed` are final. */
export type NoticeState = "pending" | "sending" | "sent" | "dropped" | "failed";

/**
 * Why a notice ended. Never a URL, an endpoint, a key or a name (REQ-J6, REQ-Y1).
 * - `delivered`: at least one device accepted it.
 * - `noSubscription`: the recipient has no device (no retry; a later device never replays it).
 * - `expired`: past its window with no rollover left.
 * - `irrelevant`: what it announced no longer holds (or its season or pause is gone).
 * - `recipientLeft`: the recipient is no longer an active member of the circle.
 * - `rejected`: every device's push service refused it for good (4xx other than 404/410/429).
 * - `exhausted`: still failing after the last retry.
 */
export type NoticeOutcome =
  | "delivered"
  | "noSubscription"
  | "expired"
  | "irrelevant"
  | "recipientLeft"
  | "rejected"
  | "exhausted";

/** What a use case hands to `enqueueNotices`: a notice to one recipient, before it has a state. */
export type NoticeDraft = NoticeContent & {
  /**
   * Unique per event and recipient; the outbox's primary key. Enqueuing a key that already exists
   * is a no-op (REQ-O2), which is what makes every enqueue site and every job re-runnable.
   */
  readonly dedupeKey: string;
  readonly circleId: CircleId;
  readonly seasonId: SeasonId | null;
  readonly recipientMemberId: MemberId;
  readonly recipientUserId: UserId;
  /** The season's timezone: quiet hours and the 09:00-22:00 window are read in it. */
  readonly timeZone: TimeZoneId;
  readonly notBefore: Instant;
  readonly expiresAt: Instant;
  /** Rollovers left (0 or 1): a `morning` notice with one left moves to the next day once. */
  readonly rolloversLeft: 0 | 1;
};

/** One row of the transactional outbox (ADR-0017). */
export type OutboxNotice = NoticeDraft & {
  readonly state: NoticeState;
  /** Claims so far. A claim counts one; a quiet-hours deferral gives it back. */
  readonly attempts: number;
  /** Set exactly while `sending`: past it, another dispatcher may claim the row again. */
  readonly leaseUntil: Instant | null;
  readonly outcome: NoticeOutcome | null;
  readonly createdAt: Instant;
  /** Set exactly when the state is final. */
  readonly finishedAt: Instant | null;
};

/** Longest a dedupe key may be (the database CHECK matches it). */
export const MAX_DEDUPE_KEY_LENGTH = 200;
