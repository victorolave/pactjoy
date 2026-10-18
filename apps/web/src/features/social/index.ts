/**
 * The public API of the social feature (change social-reactions, ADR-0018): the circle activity
 * feed with its reaction chips, the shared feed read (Today previews it), the line of one item and
 * the encouragement nudge slot the review's closing step places.
 * Everything else under `features/social` is internal.
 */

export { ActivityFeed } from "./feed/ActivityFeed.tsx";
export { FeedItemRow } from "./feed/FeedItemRow.tsx";
export { NudgeSlot } from "./nudge/NudgeSlot.tsx";
export { useFeed } from "./queries.ts";
