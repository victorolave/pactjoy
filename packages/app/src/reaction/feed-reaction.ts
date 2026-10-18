import type { MemberId } from "@pactjoy/engine";
import type { FeedReactionId, SeasonId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";

/**
 * The four reactions, by code (ADR-0018, F12). The glyph (❤️ 🙌 🔥 👏) lives in the UI, so the
 * backend never stores or compares an emoji character. No text, no comments, no chat.
 */
export const REACTION_EMOJIS = ["heart", "raisedHands", "fire", "clap"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/** Runtime check for a value that may come from an arbitrary JSON body. */
export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === "string" && (REACTION_EMOJIS as readonly string[]).includes(value);
}

/**
 * A member's reaction to ONE feed item (Reacción), identified by `(seasonId, itemKey, memberId)`:
 * a member has at most one reaction per item, which they can change or remove. The item is named
 * by its stable key (`feed/feed-key.ts`), not by an id, because the feed is derived and holds no
 * rows. A reaction whose key stops being derivable is hidden on read and never deleted.
 *
 * Reactions change no points, streak, standings or consistency, and they notify nobody.
 */
export interface FeedReaction {
  readonly id: FeedReactionId;
  readonly seasonId: SeasonId;
  readonly itemKey: string;
  /** The reactor. No foreign key (like reviews): job E anonymizes it on account deletion. */
  readonly memberId: MemberId;
  readonly emoji: ReactionEmoji;
  readonly reactedAt: Instant;
  /** Optimistic version (D5): 0 when set, +1 each time the emoji is changed. */
  readonly version: number;
}
