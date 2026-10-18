import type { FeedDeps } from "../feed/feed-context.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { feedReactionId, type SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { isReactionEmoji } from "./feed-reaction.ts";
import { loadReactableItem, type ReactionError, reactionsOf } from "./reactable-item.ts";
import type { Reactions } from "./reaction-counts.ts";

export interface ReactToFeedItemDeps extends FeedDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly ids: IdGenerator;
}

export interface ReactToFeedItemInput {
  readonly seasonId: SeasonId;
  /** The item's stable key (`feed/feed-key.ts`). May come from a URL. */
  readonly itemKey: string;
  /** One of the four codes. `string` on purpose: it may come from an arbitrary JSON body. */
  readonly emoji: string;
}

/**
 * Sets the actor's reaction to a feed item, replacing the one they had (ADR-0018, F12; REQ-R1,
 * R2, R3, R5, R10). One transaction: the item is derived from the stores it writes to, so a
 * reaction is only ever stored for an item that exists at that moment, is a member's own
 * activity, is not the actor's and whose owner is still in the circle.
 *
 * Idempotent: repeating the same call changes nothing, and a different emoji updates the same
 * row (the version bumps, the original `reactedAt` stays). Two racing first reactions end at the
 * unique `(season, item, member)` key as one row and a `ConcurrencyConflict` for the loser (the
 * client refetches). Reactions change no points, streak, standings or consistency, and notify
 * nobody.
 */
export async function reactToFeedItem(
  deps: ReactToFeedItemDeps,
  actor: Actor,
  input: ReactToFeedItemInput,
): Promise<Result<Reactions, ReactionError>> {
  const { emoji } = input;
  if (!isReactionEmoji(emoji)) return err({ kind: "InvalidReaction" });

  return deps.uow.transaction(async (repos): Promise<Result<Reactions, ReactionError>> => {
    const item = await loadReactableItem(deps, repos, actor, input);
    if (!item.ok) return item;
    const { season, viewer, record, now } = item.value;

    const existing = await repos.feedReactions.find(season.id, record.key, viewer.id);
    if (existing === null) {
      await repos.feedReactions.save(
        {
          id: feedReactionId(deps.ids.next()),
          seasonId: season.id,
          itemKey: record.key,
          memberId: viewer.id,
          emoji,
          reactedAt: now,
          version: 0,
        },
        null,
      );
    } else if (existing.emoji !== emoji) {
      await repos.feedReactions.save(
        { ...existing, emoji, version: existing.version + 1 },
        existing.version,
      );
    }
    return ok(await reactionsOf(repos, item.value));
  });
}
