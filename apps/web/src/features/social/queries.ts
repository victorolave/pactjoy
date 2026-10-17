import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { usePactJoyApi } from "../../context/api-context.tsx";
import type { DismissNudgeCommand, SendEncouragementCommand } from "../../ports/pactjoy-api.ts";
import type { CircleFeedDto, ReactionCode } from "../../ports/wire.ts";
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

/** The cached pages with one item's reactions replaced by `next`; every other item is untouched. */
function withReactions(
  data: InfiniteData<CircleFeedDto, string | null>,
  itemKey: string,
  code: ReactionCode | null,
): InfiniteData<CircleFeedDto, string | null> {
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.key === itemKey && "reactions" in item
          ? { ...item, reactions: applyReaction(item.reactions, code) }
          : item,
      ) as CircleFeedDto["items"],
    })),
  };
}

/**
 * React to an item, change the reaction or take it back. The chip answers at once (optimistic) and
 * goes back to what it was when the server refuses; the server's counts replace the guess when the
 * feed is refetched after the mutation settles. Nothing else in the cache is touched.
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
      const previous = client.getQueryData<InfiniteData<CircleFeedDto, string | null>>(feedKey);
      if (previous !== undefined)
        client.setQueryData(feedKey, withReactions(previous, itemKey, emoji));
      return { previous };
    },
    onError: (_error, _command, context) => {
      if (context?.previous !== undefined) client.setQueryData(feedKey, context.previous);
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
