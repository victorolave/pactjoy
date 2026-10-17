import type { FeedDeps } from "../feed/feed-context.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { SeasonId } from "../shared/ids.ts";
import { ok, type Result } from "../shared/result.ts";
import { loadReactableItem, type ReactionError, reactionsOf } from "./reactable-item.ts";
import type { Reactions } from "./reaction-counts.ts";

export interface RemoveFeedReactionDeps extends FeedDeps {
  readonly uow: UnitOfWork<Repositories>;
}

export interface RemoveFeedReactionInput {
  readonly seasonId: SeasonId;
  /** The item's stable key (`feed/feed-key.ts`). May come from a URL. */
  readonly itemKey: string;
}

/** Remove cannot be given an invalid emoji, so its errors are the item's. */
export type RemoveFeedReactionError = Exclude<ReactionError, { readonly kind: "InvalidReaction" }>;

/**
 * Removes the actor's reaction to a feed item (ADR-0018, F12; REQ-R2, R10). It asks the same of the
 * item as setting one does (it must exist, be reactable and not be the actor's), so the two
 * share one resolver. Idempotent: removing a reaction that is not there succeeds and changes
 * nothing, and so is a second remove racing the first: the loser's stale delete conflicts, and one
 * retry in a fresh transaction re-reads the row, finds it gone (or changed by a concurrent set)
 * and answers with what is there now. A conflict on the retry is a real one and propagates.
 */
export async function removeFeedReaction(
  deps: RemoveFeedReactionDeps,
  actor: Actor,
  input: RemoveFeedReactionInput,
): Promise<Result<Reactions, RemoveFeedReactionError>> {
  try {
    return await removeOnce(deps, actor, input);
  } catch (error) {
    if (!(error instanceof ConcurrencyConflict)) throw error;
    return removeOnce(deps, actor, input);
  }
}

function removeOnce(
  deps: RemoveFeedReactionDeps,
  actor: Actor,
  input: RemoveFeedReactionInput,
): Promise<Result<Reactions, RemoveFeedReactionError>> {
  return deps.uow.transaction(
    async (repos): Promise<Result<Reactions, RemoveFeedReactionError>> => {
      const item = await loadReactableItem(deps, repos, actor, input);
      if (!item.ok) return item as Result<never, RemoveFeedReactionError>;
      const { season, viewer, record } = item.value;

      const existing = await repos.feedReactions.find(season.id, record.key, viewer.id);
      if (existing !== null) await repos.feedReactions.remove(existing.id, existing.version);
      return ok(await reactionsOf(repos, item.value));
    },
  );
}
