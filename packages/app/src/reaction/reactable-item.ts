import type { Circle, Member } from "../circle/circle.ts";
import { deriveFeed } from "../feed/derive-feed.ts";
import {
  activeViewerOf,
  type FeedDeps,
  feedContextOf,
  guardSocialWrite,
  loadFeedWorld,
} from "../feed/feed-context.ts";
import { parseFeedItemKey } from "../feed/feed-key.ts";
import { type FeedRecord, REACTABLE_KINDS, subjectMemberOf } from "../feed/feed-record.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Instant } from "../time/instant.ts";
import { type Reactions, summarizeReactions } from "./reaction-counts.ts";

export type ReactionError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "FeedItemNotFound" }
  | { readonly kind: "FeedItemNotReactable" }
  | { readonly kind: "InvalidReaction" };

export interface ReactableItemInput {
  readonly seasonId: SeasonId;
  readonly itemKey: string;
}

/** An item the actor may react to, with what was resolved on the way (one read, one instant). */
export interface ReactableItem {
  readonly season: Season;
  readonly circle: Circle;
  readonly viewer: Member;
  readonly record: FeedRecord;
  readonly now: Instant;
}

/**
 * Resolves the item a reaction is about, INSIDE the caller's transaction (ADR-0018, F12): the feed
 * is derived here, from the same stores the transaction writes to, so a reaction can never be
 * stored for an item that is not there at that moment (REQ-R5). In this order:
 *
 * - the season exists (`SeasonNotFound`) and the actor is an ACTIVE member of its circle
 *   (`NotAMember`; a reactor who left cannot react);
 * - the season is the circle's feed season and the key names a derivable item for it
 *   (`FeedItemNotFound`; a malformed key, another season's key and an orphan all land here);
 * - the item is a member's own activity, not a system item, not the actor's, and its owner is
 *   still in the circle (`FeedItemNotReactable`).
 */
export async function loadReactableItem(
  deps: FeedDeps,
  repos: Repositories,
  actor: Actor,
  input: ReactableItemInput,
): Promise<Result<ReactableItem, ReactionError>> {
  const season = await repos.seasons.get(input.seasonId);
  if (!season) return err({ kind: "SeasonNotFound" });
  const circle = await repos.circles.get(season.circleId);
  const viewer = circle ? activeViewerOf(circle, actor) : undefined;
  if (!circle || !viewer) return err({ kind: "NotAMember" });

  // Guarded for every set and remove, including the ones that turn out to change nothing: a
  // conflict only means a leave or a season change really committed in between, and the client
  // refetches. Taken before the feed is derived, so the derivation reads what the lock protects.
  await guardSocialWrite(repos, circle, season);

  if (parseFeedItemKey(input.itemKey) === null) return err({ kind: "FeedItemNotFound" });
  const now = deps.clock.now();
  const context = await feedContextOf(deps, repos, circle, now);
  if (!context || context.season.id !== season.id) return err({ kind: "FeedItemNotFound" });

  const world = await loadFeedWorld(deps, repos, context);
  const record = deriveFeed(world).find((candidate) => candidate.key === input.itemKey);
  if (!record) return err({ kind: "FeedItemNotFound" });

  const owner = subjectMemberOf(record);
  const ownerActive = circle.members.some((m) => m.id === owner && m.status === "active");
  if (!REACTABLE_KINDS.includes(record.kind) || owner === viewer.id || !ownerActive) {
    return err({ kind: "FeedItemNotReactable" });
  }
  return ok({ season, circle, viewer, record, now });
}

/** The viewer's view of one item's reactions as the transaction now stands (read-your-own-writes). */
export async function reactionsOf(
  repos: Pick<Repositories, "feedReactions">,
  item: ReactableItem,
): Promise<Reactions> {
  const summary = summarizeReactions({
    itemKey: item.record.key,
    reactions: await repos.feedReactions.listBySeason(item.season.id),
    viewerId: item.viewer.id,
    activeMemberIds: new Set(
      item.circle.members.filter((m) => m.status === "active").map((m) => m.id),
    ),
  });
  return { ...summary, reactable: true };
}
