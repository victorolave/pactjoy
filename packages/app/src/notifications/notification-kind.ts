import type { CommitmentId } from "@pactjoy/engine";
import type { PauseRequestId, SeasonId } from "../shared/ids.ts";
import type { LocalDate } from "../time/local-date.ts";

/**
 * What each notice carries (ADR-0017): ids only, never a name, a note, a value, points or a
 * position (REQ-K1, REQ-Y2). The service worker turns `{kind, params}` into Spanish copy and a
 * destination; anything a peer must not see never enters the outbox.
 */
export interface NotificationParams {
  /** To every other active member: a request is waiting for their answer. */
  readonly pauseRequested: { readonly seasonId: SeasonId; readonly pauseRequestId: PauseRequestId };
  /** To the requester: approved by everyone, or at the 48 h deadline. */
  readonly pauseApproved: { readonly seasonId: SeasonId; readonly pauseRequestId: PauseRequestId };
  /** To the requester: someone's reject stood once everyone answered, or at the deadline. */
  readonly pauseRejected: { readonly seasonId: SeasonId; readonly pauseRequestId: PauseRequestId };
  /** To the pauser, at 09:00 the day before the pause's last day. */
  readonly pauseEndsTomorrow: {
    readonly seasonId: SeasonId;
    readonly pauseRequestId: PauseRequestId;
    readonly lastDate: LocalDate;
  };
  /** To members who have not approved the pact yet, after someone approves it. */
  readonly pactPendingApproval: { readonly seasonId: SeasonId; readonly pactRevision: number };
  readonly seasonStarted: { readonly seasonId: SeasonId };
  readonly reviewDue: { readonly seasonId: SeasonId; readonly periodIndex: number };
  /** On the results day; it absorbs the closing review (no separate `reviewDue`). */
  readonly seasonClosed: { readonly seasonId: SeasonId };
  /**
   * To the commitment's owner, at the time they chose, while that day is still open to register
   * (D2). Ids only, like every notice: the device names the habit for a visible commitment and
   * keeps the generic copy for a private one.
   */
  readonly commitmentReminder: {
    readonly seasonId: SeasonId;
    readonly commitmentId: CommitmentId;
    readonly forDate: LocalDate;
  };
}

/** The closed set of notices (REQ-F1). `notification-kind.test.ts` pins it. */
export type NotificationKind = keyof NotificationParams;

/** A notice's kind together with its params, discriminated by `kind`. */
export type NoticeContent = {
  readonly [K in NotificationKind]: { readonly kind: K; readonly params: NotificationParams[K] };
}[NotificationKind];

export interface KindPolicy {
  /**
   * `immediate`: on the next dispatch tick (quiet hours still apply). `morning`: 09:00 season-local
   * on the day it is about, until 22:00. `chosenTime`: at the owner's own time (08:00-21:45), valid
   * for one hour and never past 22:00, so quiet hours never shift it: it is sent on time or dropped.
   */
  readonly timing: "immediate" | "morning" | "chosenTime";
  /** A `morning` notice not delivered by 22:00 moves once to the next day's 09:00-22:00 window. */
  readonly rollover: boolean;
}

/** Timing per kind (ADR-0017, policy table). Exhaustive by type: a new kind needs an entry. */
export const KIND_POLICY: Readonly<Record<NotificationKind, KindPolicy>> = {
  pauseRequested: { timing: "immediate", rollover: false },
  pauseApproved: { timing: "immediate", rollover: false },
  pauseRejected: { timing: "immediate", rollover: false },
  pauseEndsTomorrow: { timing: "morning", rollover: false },
  pactPendingApproval: { timing: "immediate", rollover: false },
  seasonStarted: { timing: "morning", rollover: true },
  reviewDue: { timing: "morning", rollover: true },
  seasonClosed: { timing: "morning", rollover: true },
  commitmentReminder: { timing: "chosenTime", rollover: false },
};

export const NOTIFICATION_KINDS = Object.keys(KIND_POLICY) as readonly NotificationKind[];
