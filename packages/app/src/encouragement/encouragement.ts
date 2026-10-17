import type { MemberId } from "@pactjoy/engine";
import type { ReactionEmoji } from "../reaction/feed-reaction.ts";
import type { EncouragementId, SeasonId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";

/**
 * An encouragement one member sent another (Sugerencia de ánimo, ADR-0018, F14): one of the four
 * reaction codes, sent from a live nudge suggestion. It is insert-only, so it has no version.
 *
 * Only its recipient ever reads it ("X te envió 🙌"), and the sender gets no echo in the feed.
 * The case it answers (a hard week of the recipient) is NOT carried to the recipient: it says
 * nothing about the week, the habit or consistency.
 *
 * The database holds two unique keys: `(seasonId, senderId, recipientId, caseWeek)`, one
 * encouragement per case, and `(senderId, recipientId, sentOn)`, one per person per day. No
 * foreign key to members (like reviews): job E deletes these rows on account deletion.
 */
export interface Encouragement {
  readonly id: EncouragementId;
  readonly seasonId: SeasonId;
  readonly senderId: MemberId;
  readonly recipientId: MemberId;
  /** The recipient's hard week this answers, 1-based. */
  readonly caseWeek: number;
  readonly emoji: ReactionEmoji;
  readonly sentAt: Instant;
  /** The civil day it was sent, in the season's time zone: what the daily rule compares. */
  readonly sentOn: LocalDate;
}

/**
 * "Ahora no": a viewer hid the nudge for one case `(season, viewer, target, week)` for good, with
 * no reason asked (ADR-0018, F15). Owner-only and insert-once; nothing else ever reads it.
 */
export interface NudgeDismissal {
  readonly seasonId: SeasonId;
  readonly viewerId: MemberId;
  readonly targetId: MemberId;
  /** The target's hard week that was hidden, 1-based. */
  readonly caseWeek: number;
  readonly dismissedAt: Instant;
  /** The civil day it was dismissed, in the season's time zone: what the daily rule compares. */
  readonly dismissedOn: LocalDate;
}
