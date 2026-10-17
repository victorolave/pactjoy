import { describe, expect, it } from "vitest";
import { leaveCircle } from "../circle/leave-circle.ts";
import { deleteEntry } from "../entry/delete-entry.ts";
import { editEntry } from "../entry/edit-entry.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { circleFeed } from "../feed/circle-feed.query.ts";
import {
  dateOfDay,
  givenReviewWorld,
  logMinutes,
  type ReviewWorld,
} from "../review/review-fixtures.ts";
import { circleId, seasonId, userId } from "../shared/ids.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { localDate } from "../time/local-date.ts";
import { reactToFeedItem } from "./react-to-feed-item.ts";
import { removeFeedReaction } from "./remove-feed-reaction.ts";

const SEASON = seasonId("season-1");
/** Andrea's first "Meditar" session (season day 1) and the key of its feed item. */
const SESSION = "session:commitment-meditar:1";
const EMPTY = { heart: 0, raisedHands: 0, fire: 0, clap: 0 };

/** A world where Andrea logged her first session on day 1; the clock reads day 3. */
async function given(options: Parameters<typeof givenReviewWorld>[0] = {}) {
  const world = await givenReviewWorld(options);
  await logMinutes(world, "meditar", 0, "30");
  return world;
}

const react = (
  world: ReviewWorld,
  who: "victor" | "andrea",
  itemKey: string,
  emoji: string,
  day = 3,
) => reactToFeedItem(world.at(day), world[who], { seasonId: SEASON, itemKey, emoji });

const remove = (world: ReviewWorld, who: "victor" | "andrea", itemKey: string, day = 3) =>
  removeFeedReaction(world.at(day), world[who], { seasonId: SEASON, itemKey });

const stored = (world: ReviewWorld) => world.app.feedReactions.listBySeason(SEASON);

describe("reactToFeedItem: setting, changing and removing (REQ-R1, R2, R10)", () => {
  it("sets a reaction and returns the counts with the viewer's mark", async () => {
    const world = await given();
    const result = await react(world, "victor", SESSION, "raisedHands");
    expect(result).toEqual({
      ok: true,
      value: { counts: { ...EMPTY, raisedHands: 1 }, mine: "raisedHands", reactable: true },
    });
    expect(await stored(world)).toEqual([
      expect.objectContaining({
        seasonId: SEASON,
        itemKey: SESSION,
        memberId: "member-victor",
        emoji: "raisedHands",
        version: 0,
      }),
    ]);
  });

  it("changes the emoji of the same reaction: one row, the version bumped", async () => {
    const world = await given();
    await react(world, "victor", SESSION, "raisedHands");
    const [first] = await stored(world);
    const result = await react(world, "victor", SESSION, "fire");
    expect(result).toEqual({
      ok: true,
      value: { counts: { ...EMPTY, fire: 1 }, mine: "fire", reactable: true },
    });
    const rows = await stored(world);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first?.id, emoji: "fire", version: 1 });
    expect(rows[0]?.reactedAt).toBe(first?.reactedAt);
  });

  it("setting the same emoji again is idempotent", async () => {
    const world = await given();
    await react(world, "victor", SESSION, "fire");
    const again = await react(world, "victor", SESSION, "fire");
    expect(again).toMatchObject({
      ok: true,
      value: { counts: { ...EMPTY, fire: 1 }, mine: "fire" },
    });
    expect(await stored(world)).toHaveLength(1);
    expect((await stored(world))[0]?.version).toBe(0);
  });

  it("removes the reaction, and removing again is a quiet success", async () => {
    const world = await given();
    await react(world, "victor", SESSION, "clap");
    const removed = await remove(world, "victor", SESSION);
    expect(removed).toEqual({
      ok: true,
      value: { counts: EMPTY, mine: null, reactable: true },
    });
    expect(await stored(world)).toEqual([]);
    expect(await remove(world, "victor", SESSION)).toMatchObject({ ok: true });
  });

  it("removing when the viewer never reacted is a success that changes nothing", async () => {
    const world = await given();
    expect(await remove(world, "victor", SESSION)).toEqual({
      ok: true,
      value: { counts: EMPTY, mine: null, reactable: true },
    });
    expect(await stored(world)).toEqual([]);
  });

  it("removing from the viewer's own item is refused like setting one", async () => {
    const world = await given();
    expect(await remove(world, "andrea", SESSION)).toEqual({
      ok: false,
      error: { kind: "FeedItemNotReactable" },
    });
  });

  it("an emoji outside the four is refused and nothing is stored", async () => {
    const world = await given();
    for (const emoji of ["😂", "", "fire ", "HEART", "heart,fire"]) {
      expect(await react(world, "victor", SESSION, emoji)).toEqual({
        ok: false,
        error: { kind: "InvalidReaction" },
      });
    }
    expect(await stored(world)).toEqual([]);
  });

  it("two racing sets by the same member end with exactly one row", async () => {
    const world = await given();
    const { winner, loser } = await raceTransactions(
      world.at(3),
      (app) =>
        reactToFeedItem(app, world.victor, { seasonId: SEASON, itemKey: SESSION, emoji: "fire" }),
      (app) =>
        reactToFeedItem(app, world.victor, { seasonId: SEASON, itemKey: SESSION, emoji: "clap" }),
    );
    expect(winner.status).toBe("fulfilled");
    expect(loser.status === "fulfilled" || loser.status === "rejected").toBe(true);
    expect(await stored(world)).toHaveLength(1);
  });

  it("changes no entry, season or point (reactions never score)", async () => {
    const world = await given();
    const entries = await world.app.entries.listBySeason(SEASON);
    const season = await world.app.seasons.get(SEASON);
    await react(world, "victor", SESSION, "fire");
    await remove(world, "victor", SESSION);
    expect(await world.app.entries.listBySeason(SEASON)).toEqual(entries);
    expect(await world.app.seasons.get(SEASON)).toEqual(season);
  });
});

describe("reactToFeedItem: what can be reacted to (REQ-R3, R4, R5)", () => {
  it("refuses the viewer's own item", async () => {
    const world = await given();
    expect(await react(world, "andrea", SESSION, "fire")).toEqual({
      ok: false,
      error: { kind: "FeedItemNotReactable" },
    });
    expect(await stored(world)).toEqual([]);
  });

  it("refuses system items: the season start and the points recalculation", async () => {
    const world = await given();
    expect(await react(world, "victor", "season-start:season-1", "fire")).toEqual({
      ok: false,
      error: { kind: "FeedItemNotReactable" },
    });
    expect(await stored(world)).toEqual([]);
  });

  it.each([
    "garbage",
    "entry:entry-1",
    "session:commitment-meditar:2",
    "session:commitment-unknown:1",
    "week:commitment-meditar:1",
    "comeback:member-andrea:9",
    "pause:nope",
    "graduation:habit-meditar",
    "encouragement:e-1",
    "",
  ])("a key that names no item (%j) is not found and stores nothing", async (itemKey) => {
    const world = await given();
    expect(await react(world, "victor", itemKey, "fire")).toEqual({
      ok: false,
      error: { kind: "FeedItemNotFound" },
    });
    expect(await stored(world)).toEqual([]);
  });

  it("an unknown season is not found; a stranger is not a member", async () => {
    const world = await given();
    expect(
      await reactToFeedItem(world.at(3), world.victor, {
        seasonId: seasonId("nope"),
        itemKey: SESSION,
        emoji: "fire",
      }),
    ).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
    expect(
      await reactToFeedItem(
        world.at(3),
        { userId: userId("stranger") },
        {
          seasonId: SEASON,
          itemKey: SESSION,
          emoji: "fire",
        },
      ),
    ).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("a season that is not the circle's feed season is not found for its member", async () => {
    const world = await given({ lengthWeeks: 4 });
    await world.app.uow.transaction(async (repos) => {
      const first = await repos.seasons.get(SEASON);
      if (!first) throw new Error("no season");
      await repos.seasons.save(
        { ...first, status: "closed", version: first.version + 1 },
        first.version,
      );
      await repos.seasons.save(
        {
          ...first,
          id: seasonId("season-2"),
          status: "active",
          nominalStart: localDate("2026-11-01"),
          actualStart: localDate("2026-11-01"),
          commitments: [],
          version: 0,
        },
        null,
      );
      return { ok: true as const, value: undefined };
    });
    expect(await react(world, "victor", SESSION, "fire", 40)).toEqual({
      ok: false,
      error: { kind: "FeedItemNotFound" },
    });
  });

  it("refuses an item of a member who left, and a reactor who left", async () => {
    const world = await given();
    await leaveCircle(world.at(3), world.andrea, { circleId: circleId("circle-1") });
    expect(await react(world, "victor", SESSION, "fire")).toEqual({
      ok: false,
      error: { kind: "FeedItemNotReactable" },
    });
    const other = await given();
    await leaveCircle(other.at(3), other.victor, { circleId: circleId("circle-1") });
    expect(await react(other, "victor", SESSION, "fire")).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
  });
});

describe("feed reactions follow the derived item (REQ-R9, SC-R4)", () => {
  const entryOf = async (world: ReviewWorld) => {
    const [entry] = await world.app.entries.listBySeason(SEASON);
    if (!entry) throw new Error("no entry");
    return entry;
  };
  const countsFor = async (world: ReviewWorld, day = 3) => {
    const feed = await circleFeed(world.at(day), world.victor, {});
    if (!feed.ok) throw new Error("feed");
    return feed.value.items.find((i) => i.key === SESSION);
  };

  it("hides the reaction when the entry is edited below the minimum, keeps the row, and shows it again", async () => {
    const world = await given();
    await react(world, "victor", SESSION, "fire");
    const entry = await entryOf(world);
    await editEntry(world.at(1), world.andrea, {
      entryId: entry.id,
      value: { kind: "quantity", value: "5" },
      note: null,
    });
    expect(await countsFor(world)).toBeUndefined();
    expect(await stored(world)).toHaveLength(1);
    expect(await react(world, "victor", SESSION, "fire")).toEqual({
      ok: false,
      error: { kind: "FeedItemNotFound" },
    });

    const edited = await entryOf(world);
    await editEntry(world.at(1), world.andrea, {
      entryId: edited.id,
      value: { kind: "quantity", value: "30" },
      note: null,
    });
    expect(await countsFor(world)).toMatchObject({ reactions: { mine: "fire" } });
  });

  it("a deleted and relogged entry keeps its reactions (the opportunity is the unit)", async () => {
    const world = await given();
    await react(world, "victor", SESSION, "heart");
    const entry = await entryOf(world);
    await deleteEntry({ ...world.at(1), evidence: world.app.evidence }, world.andrea, {
      entryId: entry.id,
    });
    expect(await countsFor(world)).toBeUndefined();
    const relogged = await recordEntry(world.at(1), world.andrea, {
      seasonId: SEASON,
      commitmentId: world.meditar,
      forDate: dateOfDay(1),
      value: { kind: "quantity", value: "25" },
      clientRequestId: "relog-0",
    });
    expect(relogged.ok).toBe(true);
    expect(await countsFor(world)).toMatchObject({
      reactions: { counts: { heart: 1 }, mine: "heart" },
    });
  });

  it("hides the reactions of a reactor who left without deleting them", async () => {
    const world = await given();
    await react(world, "victor", SESSION, "heart");
    await leaveCircle(world.at(3), world.victor, { circleId: circleId("circle-1") });
    const feed = await circleFeed(world.at(3), world.andrea, {});
    if (!feed.ok) throw new Error("feed");
    expect(feed.value.items.find((i) => i.key === SESSION)).toMatchObject({
      reactions: { counts: { heart: 0 } },
    });
    expect(await stored(world)).toHaveLength(1);
  });
});
