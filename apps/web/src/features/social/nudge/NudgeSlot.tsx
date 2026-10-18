import { useFeed } from "../queries.ts";
import { NudgeCard } from "./NudgeCard.tsx";

/**
 * The nudge of the feed's first page, for a screen that is not the feed (the review's closing
 * step). It reads the same cached query as the Circle tab, shows nothing while it loads or when
 * the feed has no nudge, and never delays or blocks the screen around it.
 */
export function NudgeSlot() {
  const feed = useFeed();
  if (feed.nudge === null) return null;
  return <NudgeCard nudge={feed.nudge} members={feed.members} />;
}
