import type { MemberId } from "@pactjoy/engine";
import type { FeedReactionId, SeasonId } from "../shared/ids.ts";
import type { FeedReaction } from "./feed-reaction.ts";

/**
 * Storage port for the {@link FeedReaction} aggregate (ADR-0018, F12). Reactions are not private
 * (peers see their counts), so unlike reviews and encouragements the port has a season-wide read
 * and no guard test confines it; the sentinel tests cover what leaves the server.
 *
 * What it stores is keyed by a feed item key, and an item may have vanished since (its entry was
 * edited or deleted). The port never judges that: `listBySeason` returns every row and the counts
 * join (`reaction-counts.ts`) hides the orphans. Nothing here deletes an orphan.
 */
export interface FeedReactionRepository {
  /** Every reaction of the season, oldest first (`reactedAt`, ties by id). */
  listBySeason(seasonId: SeasonId): Promise<readonly FeedReaction[]>;
  /** The member's reaction to the item, or `null`. */
  find(seasonId: SeasonId, itemKey: string, memberId: MemberId): Promise<FeedReaction | null>;
  /**
   * Inserts (`expectedVersion` null) or updates the reaction (the emoji and its version: every
   * other field must equal the stored one). Adapters make the `(seasonId, itemKey, memberId)`
   * uniqueness atomic with the write, which is what keeps two racing sets to one stored row.
   * @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion`, or,
   * for an insert, the id or the `(seasonId, itemKey, memberId)` key already exists.
   */
  save(reaction: FeedReaction, expectedVersion: number | null): Promise<void>;
  /**
   * Removes the reaction, which frees its key for a later one.
   * @throws {ConcurrencyConflict} if the stored version is no longer `expectedVersion`, or the
   * reaction is already gone.
   */
  remove(id: FeedReactionId, expectedVersion: number): Promise<void>;
  /**
   * Full-circle erasure (ADR-0019): deletes every reaction of `seasonIds`, whoever made it. `[]`
   * is a no-op. There is no per-member delete: an erased member's own reactions to peers' items
   * stay, pseudonymous, and graduation reactions go with their season closure.
   */
  deleteBySeasons(seasonIds: readonly SeasonId[]): Promise<void>;
}
