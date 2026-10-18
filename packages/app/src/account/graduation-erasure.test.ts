import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { circleFeed } from "../feed/circle-feed.query.ts";
import { graduationKey } from "../feed/feed-key.ts";
import type { FeedItemView } from "../feed/feed-view.ts";
import { reactToFeedItem } from "../reaction/react-to-feed-item.ts";
import { dateOfDay, givenReviewWorld, logMinutes } from "../review/review-fixtures.ts";
import { storedClosure } from "../season/closure/closure-seed.ts";
import { answerClosingReview, SEASON, submitClosureAs } from "../season/closure/closure-world.ts";
import { habitId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { deleteAccount } from "./delete-account.ts";

const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");
const GRADUATION = graduationKey(habitId("habit-leer"));

type World = Awaited<ReturnType<typeof givenGraduatedWorld>>["world"];

/** Every item of every page of the feed, as `who` gets them. */
async function allItems(world: World, who: "victor" | "andrea") {
  const items: FeedItemView[] = [];
  let cursor: string | null = null;
  do {
    const page = await circleFeed(world.at(30), world[who], { cursor });
    if (!page.ok) throw new Error("setup: the feed refused");
    items.push(...page.value.items);
    cursor = page.value.nextCursor;
  } while (cursor !== null);
  return items;
}

const reactionTotal = (item: FeedItemView): number =>
  "reactions" in item ? Object.values(item.reactions.counts).reduce((a, b) => a + b, 0) : 0;

const itemOf = (items: readonly FeedItemView[], key: string): FeedItemView => {
  const item = items.find((i) => i.key === key);
  if (!item) throw new Error(`the feed has no item ${key}`);
  return item;
};

const sessionOf = (items: readonly FeedItemView[], member: typeof ANDREA) => {
  const item = items.find((i) => i.kind === "completed" && i.memberId === member);
  if (!item) throw new Error("setup: no session item for the member");
  return item.key;
};

/**
 * GIVEN, through the real use cases: Andrea and Victor each log a session; Andrea answers the
 * closing review and graduates "Leer" (Victor has not closed, so the season stays active and the
 * feed live on day 30).
 */
async function givenGraduatedWorld() {
  const world = await givenReviewWorld({ lengthWeeks: 4 });
  await logMinutes(world, "meditar", 0, "30");
  const victorLogged = await recordEntry(world.at(2), world.victor, {
    seasonId: SEASON,
    commitmentId: world.victorRun,
    forDate: dateOfDay(2),
    value: { kind: "done" },
    clientRequestId: "victor-1",
  });
  if (!victorLogged.ok) throw new Error("setup: Victor could not log");
  await answerClosingReview(world, "andrea");
  const closed = await submitClosureAs(world, "andrea", 30, [
    { commitmentId: world.meditar, decision: "continue" },
    { commitmentId: world.leer, decision: "graduate" },
  ]);
  if (!closed.ok) throw new Error(`setup: the closure was refused with ${closed.error.kind}`);
  const items = await allItems(world, "victor");
  return {
    world,
    andreasSession: sessionOf(items, ANDREA),
    victorsSession: sessionOf(items, VICTOR),
  };
}

async function react(world: World, who: "victor" | "andrea", itemKey: string) {
  const reacted = await reactToFeedItem(world.at(30), world[who], {
    seasonId: SEASON,
    itemKey,
    emoji: "clap",
  });
  if (!reacted.ok) throw new Error(`setup: the reaction was refused with ${reacted.error.kind}`);
}

describe("a graduation and its reactions when the graduate erases their account (owner option A)", () => {
  it("starts with a real graduation item that a peer reacted to", async () => {
    const { world } = await givenGraduatedWorld();
    await react(world, "victor", GRADUATION);

    const graduation = (await allItems(world, "victor")).find((item) => item.key === GRADUATION);

    expect(graduation?.kind).toBe("graduated");
    expect(graduation && reactionTotal(graduation)).toBe(1);
    expect(await storedClosure(world.app, SEASON, ANDREA)).not.toBeNull();
  });

  it("removes the graduation item, its reactions and every orphan count from the peer's feed", async () => {
    const { world, andreasSession, victorsSession } = await givenGraduatedWorld();
    await react(world, "victor", GRADUATION);
    await react(world, "victor", andreasSession);
    await react(world, "andrea", victorsSession);
    const before = await allItems(world, "victor");
    expect(before.map((item) => item.key)).toContain(GRADUATION);
    expect(reactionTotal(itemOf(before, victorsSession))).toBe(1);

    const result = await deleteAccount(
      {
        uow: world.app.uow,
        clock: world.at(30).clock,
        timeZone: world.app.timeZone,
        ids: world.app.ids,
        evidence: world.app.evidence,
        identity: world.app.identity,
      },
      world.andrea,
      { confirmation: "ELIMINAR" },
    );
    expect(result).toEqual(ok(undefined));

    const after = await allItems(world, "victor");
    expect(after.some((item) => item.kind === "graduated")).toBe(false);
    expect(after.map((item) => item.key)).not.toContain(GRADUATION);
    // Her session survives with its value, but a left member's items are frozen: no counts.
    expect(after.map((item) => item.key)).toContain(andreasSession);
    // Nothing stored targets the vanished item, and her own reaction stays stored (pseudonymous).
    const stored = await world.app.feedReactions.listBySeason(SEASON);
    expect(stored.map((r) => r.itemKey).sort()).toEqual([andreasSession, victorsSession].sort());
    // Every item shows exactly the stored reactions of members still in the circle.
    for (const item of after) {
      const countable = stored.filter((r) => r.itemKey === item.key && r.memberId === VICTOR);
      const frozen = "memberId" in item && item.memberId === ANDREA;
      expect(reactionTotal(item)).toBe(frozen ? 0 : countable.length);
    }
    expect(reactionTotal(itemOf(after, victorsSession))).toBe(0);
    expect(await storedClosure(world.app, SEASON, ANDREA)).toBeNull();
  });
});
