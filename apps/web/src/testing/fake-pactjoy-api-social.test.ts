import { describe, expect, it } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import { FakePactJoyApi } from "./fake-pactjoy-api.ts";
import {
  ANDREA,
  completedItemFixture,
  consistentWeekItemFixture,
  emptyFeedFixture,
  feedFixture,
  nudgeFixture,
  reactionsFixture,
  seasonStartedItemFixture,
} from "./fixtures/social.ts";
import { activeTodayFixture } from "./fixtures/today.ts";

const make = () => new FakePactJoyApi(activeTodayFixture());

describe("FakePactJoyApi social methods", () => {
  it("answers an empty feed until one is scripted", async () => {
    const api = make();
    await expect(api.feed()).resolves.toEqual(emptyFeedFixture());
    expect(api.calls.feed).toBe(1);
  });

  it("serves scripted pages by cursor and keeps the nudge on the first page only", async () => {
    const api = make();
    const second = feedFixture({ items: [seasonStartedItemFixture()] });
    api.setFeedPages([feedFixture({ nudge: nudgeFixture() }), second]);
    const first = await api.feed();
    expect(first.nextCursor).toBe("page-1");
    expect(first.nudge).toEqual(nudgeFixture());
    const next = await api.feed(first.nextCursor);
    expect(next.items).toEqual(second.items);
    expect(next.nextCursor).toBeNull();
    expect(next.nudge).toBeNull();
  });

  it("rejects a cursor it never handed out", async () => {
    const api = make();
    api.setFeedPages([feedFixture()]);
    await expect(api.feed("page-7")).rejects.toMatchObject({ code: "InvalidFeedCursor" });
  });

  it("reacts like the server: counts the emoji, remembers mine, changes it, removes it", async () => {
    const api = make();
    const item = completedItemFixture();
    api.setFeedPages([feedFixture({ items: [item] })]);
    await expect(api.reactToFeedItem("season-1", item.key, "heart")).resolves.toEqual(
      reactionsFixture({ counts: { heart: 1, raisedHands: 0, fire: 0, clap: 0 }, mine: "heart" }),
    );
    await expect(api.reactToFeedItem("season-1", item.key, "fire")).resolves.toEqual(
      reactionsFixture({ counts: { heart: 0, raisedHands: 0, fire: 1, clap: 0 }, mine: "fire" }),
    );
    const read = await api.feed();
    expect(read.items[0]).toMatchObject({
      reactions: { counts: { fire: 1, heart: 0 }, mine: "fire" },
    });
    await expect(api.removeFeedReaction("season-1", item.key)).resolves.toEqual(reactionsFixture());
    expect(api.socialCommands).toEqual([
      { method: "reactToFeedItem", args: ["season-1", item.key, "heart"] },
      { method: "reactToFeedItem", args: ["season-1", item.key, "fire"] },
      { method: "removeFeedReaction", args: ["season-1", item.key] },
    ]);
  });

  it("answers FeedItemNotReactable for an item that cannot be reacted to", async () => {
    const api = make();
    const item = consistentWeekItemFixture({ reactions: reactionsFixture({ reactable: false }) });
    api.setFeedPages([feedFixture({ items: [item] })]);
    await expect(api.reactToFeedItem("season-1", item.key, "clap")).rejects.toMatchObject({
      code: "FeedItemNotReactable",
    });
    await expect(api.reactToFeedItem("season-1", "nope:1", "clap")).rejects.toMatchObject({
      code: "FeedItemNotFound",
    });
  });

  it("records an encouragement and stops offering the nudge, like the server", async () => {
    const api = make();
    api.setFeedPages([feedFixture({ nudge: nudgeFixture() })]);
    await api.sendEncouragement("season-1", { recipientId: ANDREA, week: 2, emoji: "raisedHands" });
    expect((await api.feed()).nudge).toBeNull();
    expect(api.socialCommands).toEqual([
      {
        method: "sendEncouragement",
        args: ["season-1", { recipientId: ANDREA, week: 2, emoji: "raisedHands" }],
      },
    ]);
  });

  it("records a dismissal and stops offering the nudge", async () => {
    const api = make();
    api.setFeedPages([feedFixture({ nudge: nudgeFixture() })]);
    await api.dismissNudge("season-1", { targetId: ANDREA, week: 2 });
    expect((await api.feed()).nudge).toBeNull();
    expect(api.calls.dismissNudge).toBe(1);
  });

  it("fails the next call when told to, and can hold one", async () => {
    const api = make();
    api.failNext("reactToFeedItem", new ApiError("NetworkError", 0, null));
    await expect(api.reactToFeedItem("s", "k:1", "heart")).rejects.toMatchObject({
      code: "NetworkError",
    });
    api.failNext("sendEncouragement", new ApiError("EncouragementAlreadySent", 409, null));
    await expect(
      api.sendEncouragement("s", { recipientId: ANDREA, week: 2, emoji: "fire" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
