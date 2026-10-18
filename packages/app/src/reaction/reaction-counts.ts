import type { MemberId } from "@pactjoy/engine";
import { type FeedReaction, REACTION_EMOJIS, type ReactionEmoji } from "./feed-reaction.ts";

/** How many reactions an item has per emoji. Reactor identities are never part of it. */
export type ReactionCounts = Record<ReactionEmoji, number>;

/** What a viewer sees of the reactions to one item. */
export interface ReactionSummary {
  readonly counts: ReactionCounts;
  /** The viewer's own reaction, if any. */
  readonly mine: ReactionEmoji | null;
}

/** What a viewer sees of one item's reactions, and whether they can still react (ADR-0018, F12). */
export interface Reactions extends ReactionSummary {
  readonly reactable: boolean;
}

export function emptyCounts(): ReactionCounts {
  return Object.fromEntries(REACTION_EMOJIS.map((emoji) => [emoji, 0])) as ReactionCounts;
}

export interface SummarizeInput {
  readonly itemKey: string;
  /** Every stored reaction of the season: the join picks the item's, so an orphaned key is simply never asked for. */
  readonly reactions: readonly FeedReaction[];
  readonly viewerId: MemberId;
  /** The members still in the circle: the reactions of anyone else are hidden, never deleted. */
  readonly activeMemberIds: ReadonlySet<MemberId>;
}

/**
 * The counts join (ADR-0018, F12): counts per emoji and the viewer's own mark for ONE item. Only
 * the reactions of members who are still in the circle count. The reactions are read, never
 * written or deleted here, so a reaction that is hidden today (its reactor left, its item
 * vanished) can come back with no repair step.
 */
export function summarizeReactions(input: SummarizeInput): ReactionSummary {
  const counts = emptyCounts();
  let mine: ReactionEmoji | null = null;
  for (const reaction of input.reactions) {
    if (reaction.itemKey !== input.itemKey || !input.activeMemberIds.has(reaction.memberId))
      continue;
    counts[reaction.emoji] += 1;
    if (reaction.memberId === input.viewerId) mine = reaction.emoji;
  }
  return { counts, mine };
}
