import { describe, expect, it } from "vitest";
import {
  completedItemFixture,
  consistentWeekItemFixture,
  emptyFeedFixture,
  encouragementReceivedItemFixture,
  feedFixture,
  nudgeFixture,
  PRIVATE_SUBJECT,
  reactionsFixture,
  seasonStartedItemFixture,
} from "../testing/fixtures/social.ts";
import { isCircleFeed, isReactions, isSentEncouragement } from "./social-guards.ts";

describe("isCircleFeed", () => {
  it("accepts a full first page, the empty feed and a page with a nudge", () => {
    expect(isCircleFeed(feedFixture())).toBe(true);
    expect(isCircleFeed(emptyFeedFixture())).toBe(true);
    expect(isCircleFeed(feedFixture({ nudge: nudgeFixture(), nextCursor: "abc" }))).toBe(true);
    expect(isCircleFeed(feedFixture({ nudge: nudgeFixture({ subject: PRIVATE_SUBJECT }) }))).toBe(
      true,
    );
  });

  it("accepts every item kind of the wire", () => {
    const reactions = reactionsFixture();
    const items = [
      completedItemFixture(),
      completedItemFixture({ value: null, subject: PRIVATE_SUBJECT }),
      consistentWeekItemFixture(),
      consistentWeekItemFixture({ kept: null, counted: null }),
      {
        key: "comeback:m:3",
        kind: "comeback",
        onDate: "2026-10-03",
        at: null,
        memberId: "m",
        reactions,
      },
      {
        key: "pause:p1",
        kind: "paused",
        onDate: "2026-10-03",
        at: null,
        memberId: "m",
        subjects: [PRIVATE_SUBJECT],
        reason: null,
        reactions,
      },
      {
        key: "recalc:p1",
        kind: "pointsRecalculated",
        onDate: "2026-10-03",
        at: null,
        subjects: [PRIVATE_SUBJECT],
        memberId: "m",
      },
      {
        key: "graduation:h1",
        kind: "graduated",
        onDate: "2026-10-03",
        at: null,
        memberId: "m",
        subject: PRIVATE_SUBJECT,
        reactions,
      },
      seasonStartedItemFixture(),
      { key: "season-close:s", kind: "seasonClosed", onDate: "2026-12-01", at: null },
      encouragementReceivedItemFixture(),
    ];
    expect(isCircleFeed(feedFixture({ items: items as never }))).toBe(true);
  });

  it("accepts a member who left without a name, and refuses a name that is not text", () => {
    const ok = feedFixture();
    const left = { id: "m-left", displayName: null, isYou: false, left: true };
    expect(isCircleFeed({ ...ok, members: [...ok.members, left] })).toBe(true);
    expect(isCircleFeed({ ...ok, members: [{ ...left, displayName: 4 }] })).toBe(false);
    expect(isCircleFeed({ ...ok, members: [{ id: "m-left", isYou: false, left: true }] })).toBe(
      false,
    );
  });

  it("rejects a body that is not a feed", () => {
    for (const bad of [null, "feed", [], {}, { items: [] }]) expect(isCircleFeed(bad)).toBe(false);
  });

  it("rejects a malformed envelope: members, cursor, nudge", () => {
    const ok = feedFixture();
    expect(isCircleFeed({ ...ok, members: "Andrea" })).toBe(false);
    expect(isCircleFeed({ ...ok, members: [{ id: "x" }] })).toBe(false);
    expect(isCircleFeed({ ...ok, nextCursor: 3 })).toBe(false);
    expect(isCircleFeed({ ...ok, nudge: { seasonId: "s" } })).toBe(false);
    expect(isCircleFeed({ ...ok, nudge: nudgeFixture({ week: 0 }) })).toBe(false);
    expect(isCircleFeed({ ...ok, seasonId: 4 })).toBe(false);
  });

  it("rejects an item of an unknown kind or with a missing common field", () => {
    const ok = feedFixture();
    expect(isCircleFeed({ ...ok, items: [{ ...completedItemFixture(), kind: "shamed" }] })).toBe(
      false,
    );
    expect(isCircleFeed({ ...ok, items: [{ ...completedItemFixture(), key: 1 }] })).toBe(false);
    expect(isCircleFeed({ ...ok, items: [{ ...completedItemFixture(), onDate: null }] })).toBe(
      false,
    );
    expect(isCircleFeed({ ...ok, items: [{ ...completedItemFixture(), at: 5 }] })).toBe(false);
    expect(isCircleFeed({ ...ok, items: [null] })).toBe(false);
  });

  it("rejects an item whose subject, value or reactions are malformed", () => {
    const ok = feedFixture();
    const bad = (patch: object) =>
      isCircleFeed({ ...ok, items: [{ ...completedItemFixture(), ...patch }] });
    expect(bad({ subject: { kind: "habit" } })).toBe(false);
    expect(bad({ subject: { kind: "secret" } })).toBe(false);
    expect(bad({ value: { amount: 5, unit: "km", customLabel: null } })).toBe(false);
    expect(bad({ value: { amount: "5", unit: "parsecs", customLabel: null } })).toBe(false);
    expect(bad({ reactions: { counts: { heart: 1 }, mine: null, reactable: true } })).toBe(false);
    expect(bad({ reactions: reactionsFixture({ mine: "thumbsUp" as never }) })).toBe(false);
    expect(bad({ reactions: undefined })).toBe(false);
  });
});

describe("isReactions", () => {
  it("accepts counts, a mine code and the reactable flag", () => {
    expect(isReactions(reactionsFixture())).toBe(true);
    expect(
      isReactions(
        reactionsFixture({ counts: { heart: 2, raisedHands: 0, fire: 1, clap: 0 }, mine: "fire" }),
      ),
    ).toBe(true);
  });

  it("rejects negative or fractional counts, an unknown code and a missing flag", () => {
    expect(
      isReactions(reactionsFixture({ counts: { heart: -1, raisedHands: 0, fire: 0, clap: 0 } })),
    ).toBe(false);
    expect(
      isReactions(reactionsFixture({ counts: { heart: 0.5, raisedHands: 0, fire: 0, clap: 0 } })),
    ).toBe(false);
    expect(isReactions({ ...reactionsFixture(), mine: "x" })).toBe(false);
    expect(isReactions({ counts: reactionsFixture().counts, mine: null })).toBe(false);
    expect(isReactions(null)).toBe(false);
  });
});

describe("isSentEncouragement", () => {
  it("accepts the recipient and the case week", () => {
    expect(isSentEncouragement({ recipientId: "m1", week: 2 })).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isSentEncouragement({ recipientId: "", week: 2 })).toBe(false);
    expect(isSentEncouragement({ recipientId: "m1", week: 0 })).toBe(false);
    expect(isSentEncouragement({})).toBe(false);
    expect(isSentEncouragement(null)).toBe(false);
  });
});
