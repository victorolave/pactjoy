import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { feedReactionId } from "../shared/ids.ts";
import { feedReactionFixture } from "../testing/builders.ts";
import type { FeedReaction } from "./feed-reaction.ts";
import { emptyCounts, summarizeReactions } from "./reaction-counts.ts";

const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");
const CARLA = memberId("member-carla");
const ITEM = "session:commitment-1:1";

const react = (
  id: string,
  by: ReturnType<typeof memberId>,
  emoji: FeedReaction["emoji"],
  itemKey = ITEM,
) => feedReactionFixture({ id: feedReactionId(id), memberId: by, emoji, itemKey });

const active = new Set([ANDREA, VICTOR, CARLA]);

describe("summarizeReactions (the counts join, F12)", () => {
  it("counts per emoji and marks the viewer's own, never naming a reactor", () => {
    const summary = summarizeReactions({
      itemKey: ITEM,
      reactions: [react("1", VICTOR, "raisedHands"), react("2", CARLA, "raisedHands")],
      viewerId: VICTOR,
      activeMemberIds: active,
    });
    expect(summary).toEqual({
      counts: { heart: 0, raisedHands: 2, fire: 0, clap: 0 },
      mine: "raisedHands",
    });
    expect(JSON.stringify(summary)).not.toContain("member-");
  });

  it("an item nobody reacted to has zero counts and no mark", () => {
    expect(
      summarizeReactions({
        itemKey: ITEM,
        reactions: [],
        viewerId: VICTOR,
        activeMemberIds: active,
      }),
    ).toEqual({ counts: emptyCounts(), mine: null });
  });

  it("counts only the reactions to that item (orphans of other keys never show)", () => {
    const summary = summarizeReactions({
      itemKey: ITEM,
      reactions: [
        react("1", VICTOR, "fire"),
        react("2", CARLA, "fire", "session:commitment-1:2"),
        react("3", CARLA, "fire", "week:gone-commitment:1"),
      ],
      viewerId: ANDREA,
      activeMemberIds: active,
    });
    expect(summary.counts.fire).toBe(1);
    expect(summary.mine).toBeNull();
  });

  it("hides the reactions of members who left", () => {
    const summary = summarizeReactions({
      itemKey: ITEM,
      reactions: [react("1", CARLA, "heart"), react("2", VICTOR, "heart")],
      viewerId: ANDREA,
      activeMemberIds: new Set([ANDREA, VICTOR]),
    });
    expect(summary.counts.heart).toBe(1);
  });

  it("emptyCounts is a fresh object every time", () => {
    expect(emptyCounts()).not.toBe(emptyCounts());
    expect(Object.keys(emptyCounts())).toEqual(["heart", "raisedHands", "fire", "clap"]);
  });
});
