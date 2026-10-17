import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { usePactJoyApi } from "../../context/api-context.tsx";
import type { DismissNudgeCommand, SendEncouragementCommand } from "../../ports/pactjoy-api.ts";
import type { CircleFeedDto, ReactionCode, ReactionsDto } from "../../ports/wire.ts";
import { feedKey } from "../../shared/query-keys.ts";
import { applyReaction } from "./reactions/apply-reaction.ts";

/**
 * The circle activity feed (ADR-0018): pages of 20 newest first, the first one also carrying the
 * encouragement nudge. Read live and NOT persisted offline (a stale feed would offer a nudge that
 * was already answered); every settled mutation marks it stale (`createQueryClient`).
 */
export function useFeed() {
  const api = usePactJoyApi();
  const query = useInfiniteQuery({
    queryKey: feedKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => api.feed(pageParam, signal),
    getNextPageParam: (last) => last.nextCursor,
  });
  const pages = query.data?.pages;
  return useMemo(
    () => ({
      ...query,
      items: pages?.flatMap((page) => page.items) ?? [],
      members: pages?.[0]?.members ?? [],
      seasonId: pages?.[0]?.seasonId ?? null,
      nudge: pages?.[0]?.nudge ?? null,
    }),
    [query, pages],
  );
}

export interface ReactCommand {
  readonly itemKey: string;
  /** The viewer's reaction afterwards; `null` takes it back. */
  readonly emoji: ReactionCode | null;
}

type FeedData = InfiniteData<CircleFeedDto, string | null>;

/** The cached pages with one item's reactions rewritten by `change`; every other item is untouched. */
function mapReactions(
  data: FeedData,
  itemKey: string,
  change: (reactions: ReactionsDto) => ReactionsDto,
): FeedData {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.key === itemKey && "reactions" in item
          ? { ...item, reactions: change(item.reactions) }
          : item,
      ) as CircleFeedDto["items"],
    })),
  };
}

/** What one item's reactions were in the cache, or `undefined` when it has none (or is not there). */
function reactionsIn(data: FeedData | undefined, itemKey: string): ReactionsDto | undefined {
  for (const page of data?.pages ?? []) {
    const item = page.items.find((candidate) => candidate.key === itemKey);
    if (item !== undefined && "reactions" in item) return item.reactions;
  }
  return undefined;
}

/**
 * React to an item, change the reaction or take it back. The chip answers at once (optimistic) and
 * goes back to what it was when the server refuses; the server's counts replace the guess when the
 * feed is refetched after the mutation settles. Nothing else in the cache is touched, on the way
 * in or on the way back: a refusal restores THAT item only, so another reaction made meanwhile
 * keeps its optimistic state.
 */
export function useReact(seasonId: string) {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ itemKey, emoji }: ReactCommand) =>
      emoji === null
        ? api.removeFeedReaction(seasonId, itemKey)
        : api.reactToFeedItem(seasonId, itemKey, emoji),
    onMutate: async ({ itemKey, emoji }) => {
      await client.cancelQueries({ queryKey: feedKey });
      const cached = client.getQueryData<FeedData>(feedKey);
      const previous = reactionsIn(cached, itemKey);
      if (cached !== undefined)
        client.setQueryData(
          feedKey,
          mapReactions(cached, itemKey, (reactions) => applyReaction(reactions, emoji)),
        );
      return { previous };
    },
    onError: (_error, { itemKey }, context) => {
      const current = client.getQueryData<FeedData>(feedKey);
      const previous = context?.previous;
      if (current !== undefined && previous !== undefined)
        client.setQueryData(
          feedKey,
          mapReactions(current, itemKey, () => previous),
        );
    },
  });
}

/** Sends the nudge's encouragement; the nudge leaves the feed when it is refetched. */
export function useSendEncouragement(seasonId: string) {
  const api = usePactJoyApi();
  return useMutation({
    mutationFn: (cmd: SendEncouragementCommand) => api.sendEncouragement(seasonId, cmd),
  });
}

/** "Ahora no": the nudge is not offered again for this case. */
export function useDismissNudge(seasonId: string) {
  const api = usePactJoyApi();
  return useMutation({
    mutationFn: (cmd: DismissNudgeCommand) => api.dismissNudge(seasonId, cmd),
  });
}
