/**
 * The public API of the social feature (change social-reactions, ADR-0018): the circle activity
 * feed with its reaction chips, the shared feed read (Today previews it) and the line of one item.
 * Everything else under `features/social` is internal.
 */

export { ActivityFeed } from "./feed/ActivityFeed.tsx";
export { FeedItemRow } from "./feed/FeedItemRow.tsx";
export { useFeed } from "./queries.ts";
