import type { MemberId } from "@pactjoy/engine";
import type { Circle } from "../circle/circle.ts";
import {
  loadNudgeSuggestion,
  loadReceivedRecords,
  type NudgeSuggestion,
} from "../encouragement/nudge-for-viewer.ts";
import type { ScoreQueryDeps } from "../score/score-context.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { deriveFeed } from "./derive-feed.ts";
import { activeViewerOf, feedContextOf, loadFeedWorld } from "./feed-context.ts";
import { decodeFeedCursor, pageOf, sortFeed } from "./feed-cursor.ts";
import { type FeedItemView, presentFeedItems } from "./feed-view.ts";

export type CircleFeedDeps = ScoreQueryDeps;

export interface CircleFeedInput {
  /** The `nextCursor` of the previous page; absent or `null` for the first page. */
  readonly cursor?: string | null;
}

/** A member of the circle as the feed names them. `userId` never appears. */
export interface FeedMember {
  readonly id: MemberId;
  readonly displayName: string;
  readonly isYou: boolean;
  readonly left: boolean;
}

export interface CircleFeed {
  /** The feed season, or `null` when the circle has none that has started (or there is no circle). */
  readonly seasonId: SeasonId | null;
  readonly members: readonly FeedMember[];
  readonly items: readonly FeedItemView[];
  /** The cursor of the next page, or `null` on the last one. */
  readonly nextCursor: string | null;
  /**
   * The one encouragement the viewer may be offered now (ADR-0018, F13), on the FIRST page only;
   * `null` on later pages and when there is none.
   */
  readonly nudge: NudgeSuggestion | null;
}

export type CircleFeedError = { readonly kind: "InvalidFeedCursor" };

function membersOf(circle: Circle, viewerId: MemberId | undefined): FeedMember[] {
  return circle.members.map((member) => ({
    id: member.id,
    displayName: member.displayName,
    isYou: member.id === viewerId,
    left: member.status === "left",
  }));
}

/**
 * The activity feed of the viewer's active circle (ADR-0018, F1, F2, F10, F11): the newest started
 * season, derived on every read from entries, effective pauses, `Habit.graduatedAt` and dates,
 * sorted newest first, paged by an opaque cursor and presented for THIS viewer (private
 * commitments masked, values only on visible ones, reactions as counts). It never writes.
 *
 * A caller with no active circle, or a circle with no started season, gets an empty feed rather
 * than an error: the client decides what to show. Only a cursor that is not ours is refused.
 */
export async function circleFeed(
  deps: CircleFeedDeps,
  actor: Actor,
  input: CircleFeedInput = {},
): Promise<Result<CircleFeed, CircleFeedError>> {
  const position =
    input.cursor === undefined || input.cursor === null ? null : decodeFeedCursor(input.cursor);
  if (input.cursor !== undefined && input.cursor !== null && position === null) {
    return err({ kind: "InvalidFeedCursor" });
  }

  return deps.uow.read(async (repos): Promise<Result<CircleFeed, CircleFeedError>> => {
    const circle = await repos.circles.findActiveByUser(actor.userId);
    const viewer = circle ? activeViewerOf(circle, actor) : undefined;
    if (!circle || !viewer) {
      return ok({ seasonId: null, members: [], items: [], nextCursor: null, nudge: null });
    }
    const members = membersOf(circle, viewer.id);
    const context = await feedContextOf(deps, repos, circle, deps.clock.now());
    if (!context) return ok({ seasonId: null, members, items: [], nextCursor: null, nudge: null });

    const world = await loadFeedWorld(deps, repos, context);
    // The viewer's own received encouragements join the derived records before sorting and paging.
    const received = await loadReceivedRecords(repos, context.season, circle, viewer);
    const page = pageOf(sortFeed([...deriveFeed(world), ...received]), position);
    const items = presentFeedItems({
      records: page.items,
      season: context.season,
      circle,
      habits: world.habits,
      viewer,
      reactions: await repos.feedReactions.listBySeason(context.season.id),
    });
    // The suggestion rides on the first page only; later pages are just more history.
    const nudge =
      position === null ? await loadNudgeSuggestion(repos, context, world, viewer) : null;
    return ok({
      seasonId: context.season.id,
      members,
      items,
      nextCursor: page.nextCursor,
      nudge,
    });
  });
}
