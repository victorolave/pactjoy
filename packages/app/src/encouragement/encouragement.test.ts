import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { circleFeed } from "../feed/circle-feed.query.ts";
import { reactToFeedItem } from "../reaction/react-to-feed-item.ts";
import {
  dateOfDay,
  givenReviewWorld,
  logMinutes,
  type ReviewWorld,
} from "../review/review-fixtures.ts";
import { seasonId, userId } from "../shared/ids.ts";
import { localInstant } from "../testing/entry-fixtures.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { dismissNudge } from "./dismiss-nudge.ts";
import { sendEncouragement } from "./send-encouragement.ts";

const SEASON = seasonId("season-1");
const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");

/**
 * Andrea kept 2 of 7 Meditar and 0 of 1 Leer in week 1: a hard week, final from season day 9
 * (1-based). Victor is the viewer; his own empty week is a hard one too, but he is never his own case.
 */
async function given(options: Parameters<typeof givenReviewWorld>[0] = {}): Promise<ReviewWorld> {
  const world = await givenReviewWorld(options);
  await logMinutes(world, "meditar", 0);
  await logMinutes(world, "meditar", 1);
  return world;
}

const DAY = 9;

const send = (
  world: ReviewWorld,
  overrides: Partial<Parameters<typeof sendEncouragement>[2]> = {},
  day = DAY,
  who: "victor" | "andrea" = "victor",
) =>
  sendEncouragement(world.at(day), world[who], {
    seasonId: SEASON,
    recipientId: ANDREA,
    week: 1,
    emoji: "raisedHands",
    ...overrides,
  });

const dismiss = (
  world: ReviewWorld,
  overrides: Partial<Parameters<typeof dismissNudge>[2]> = {},
  day = DAY,
) =>
  dismissNudge(world.at(day), world.victor, {
    seasonId: SEASON,
    targetId: ANDREA,
    week: 1,
    ...overrides,
  });

async function feedFor(world: ReviewWorld, who: "victor" | "andrea", day = DAY, cursor?: string) {
  const result = await circleFeed(world.at(day), world[who], cursor ? { cursor } : {});
  if (!result.ok) throw new Error(`feed failed: ${result.error.kind}`);
  return result.value;
}

describe("the nudge in the circle feed (REQ-N1, N3, N7)", () => {
  it("offers the viewer ONE case on the first page: the member, the week and the subject", async () => {
    const world = await given();
    const feed = await feedFor(world, "victor");
    expect(feed.nudge).toEqual({
      seasonId: SEASON,
      targetId: ANDREA,
      week: 1,
      subject: { kind: "habit", name: "Meditar", icon: "book" },
    });
  });

  it("offers nothing before the week is final, and nothing to the member it is about", async () => {
    const world = await given();
    expect((await feedFor(world, "victor", 8)).nudge).toBeNull();
    // Andrea's own case is not hers to see: Victor's empty week is the one offered to her.
    expect((await feedFor(world, "andrea")).nudge).toMatchObject({ targetId: VICTOR });
  });

  it("masks a private commitment as a private subject", async () => {
    const world = await given();
    await world.app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(SEASON);
      if (!season) throw new Error("no season");
      const commitments = season.commitments.map((c) =>
        c.id === world.meditar ? { ...c, privacy: "private" as const } : c,
      );
      await repos.seasons.save(
        { ...season, commitments, version: season.version + 1 },
        season.version,
      );
      return { ok: true as const, value: undefined };
    });
    const nudge = (await feedFor(world, "victor")).nudge;
    expect(nudge).toMatchObject({ targetId: ANDREA, subject: { kind: "private" } });
    expect(JSON.stringify(nudge)).not.toContain("Meditar");
  });

  it("is only on the first page", async () => {
    const world = await given();
    for (let day = 2; day < 30; day++) await logMinutes(world, "meditar", day, "30");
    const first = await feedFor(world, "victor", 40);
    expect(first.nextCursor).not.toBeNull();
    expect(first.nudge).toMatchObject({ targetId: ANDREA });
    const second = await feedFor(world, "victor", 40, first.nextCursor ?? "");
    expect(second.nudge).toBeNull();
  });

  it("is never offered in a circle of one", async () => {
    const world = await given({ solo: true });
    const feed = await circleFeed(world.at(DAY), world.andrea, {});
    expect(feed).toMatchObject({ ok: true, value: { nudge: null } });
  });

  it("reading it writes nothing", async () => {
    const world = await given();
    await feedFor(world, "victor");
    await feedFor(world, "victor");
    expect(await world.app.encouragements.listSent(SEASON, VICTOR)).toEqual([]);
    expect(await world.app.nudgeDismissals.listMine(SEASON, VICTOR)).toEqual([]);
  });
});

describe("sendEncouragement (REQ-N5, N6)", () => {
  it("stores one encouragement from the live case, on the season's day", async () => {
    const world = await given();
    const result = await send(world);
    expect(result).toEqual({ ok: true, value: { recipientId: ANDREA, week: 1 } });
    const [stored] = await world.app.encouragements.listSent(SEASON, VICTOR);
    expect(stored).toMatchObject({
      seasonId: SEASON,
      senderId: VICTOR,
      recipientId: ANDREA,
      caseWeek: 1,
      emoji: "raisedHands",
      sentOn: dateOfDay(DAY),
      sentAt: localInstant(dateOfDay(DAY)),
    });
  });

  it("takes the day in the season's time zone, not the UTC day", async () => {
    const world = await given();
    // 23:30 local on day 9 is already the next UTC day (the fixture zone is UTC-3).
    const late = {
      ...world.at(DAY),
      clock: { now: () => localInstant(dateOfDay(DAY), 23 * 3_600_000 + 30 * 60_000) },
    };
    await sendEncouragement(late, world.victor, {
      seasonId: SEASON,
      recipientId: ANDREA,
      week: 1,
      emoji: "fire",
    });
    const [stored] = await world.app.encouragements.listSent(SEASON, VICTOR);
    expect(stored?.sentOn).toBe(dateOfDay(DAY));
  });

  it("after sending, the viewer is offered nothing more that day (strict daily rule)", async () => {
    const world = await given();
    await send(world);
    expect((await feedFor(world, "victor")).nudge).toBeNull();
  });

  it("a second send for the same case is refused as already sent, and stores nothing more", async () => {
    const world = await given();
    await send(world);
    expect(await send(world, { emoji: "fire" })).toEqual({
      ok: false,
      error: { kind: "EncouragementAlreadySent" },
    });
    expect(await send(world, { emoji: "fire" }, DAY + 1)).toEqual({
      ok: false,
      error: { kind: "EncouragementAlreadySent" },
    });
    expect(await world.app.encouragements.listSent(SEASON, VICTOR)).toHaveLength(1);
  });

  it.each([
    ["a week that is not the live one", { week: 2 }],
    ["week 0", { week: 0 }],
    ["a fractional week", { week: 1.5 }],
    ["the sender themself", { recipientId: VICTOR }],
    ["a member who is not in the circle", { recipientId: memberId("member-nobody") }],
  ])("refuses %s as not available", async (_name, overrides) => {
    const world = await given();
    expect(await send(world, overrides)).toEqual({
      ok: false,
      error: { kind: "NudgeNotAvailable" },
    });
    expect(await world.app.encouragements.listSent(SEASON, VICTOR)).toEqual([]);
  });

  it("refuses before the week is final", async () => {
    const world = await given();
    expect(await send(world, {}, 8)).toEqual({ ok: false, error: { kind: "NudgeNotAvailable" } });
  });

  it("refuses a case the viewer dismissed", async () => {
    const world = await given();
    await dismiss(world);
    expect(await send(world, {}, DAY + 1)).toEqual({
      ok: false,
      error: { kind: "NudgeNotAvailable" },
    });
  });

  it("refuses an emoji outside the four", async () => {
    const world = await given();
    for (const emoji of ["😂", "", "heart ", "love"]) {
      expect(await send(world, { emoji })).toEqual({
        ok: false,
        error: { kind: "InvalidReaction" },
      });
    }
    expect(await world.app.encouragements.listSent(SEASON, VICTOR)).toEqual([]);
  });

  it("refuses an unknown season and a stranger", async () => {
    const world = await given();
    expect(await send(world, { seasonId: seasonId("nope") })).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
    expect(
      await sendEncouragement(
        world.at(DAY),
        { userId: userId("stranger") },
        {
          seasonId: SEASON,
          recipientId: ANDREA,
          week: 1,
          emoji: "fire",
        },
      ),
    ).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("two racing sends of the same case end with exactly one encouragement", async () => {
    const world = await given();
    const attempt = (app: ReviewWorld["app"]) =>
      sendEncouragement(app, world.victor, {
        seasonId: SEASON,
        recipientId: ANDREA,
        week: 1,
        emoji: "heart",
      });
    const { winner, loser } = await raceTransactions(world.at(DAY), attempt, attempt);
    expect(winner.status).toBe("fulfilled");
    expect(loser.status === "fulfilled" || loser.status === "rejected").toBe(true);
    expect(await world.app.encouragements.listSent(SEASON, VICTOR)).toHaveLength(1);
  });

  it("changes no points, entries or season", async () => {
    const world = await given();
    const entries = await world.app.entries.listBySeason(SEASON);
    const season = await world.app.seasons.get(SEASON);
    await send(world);
    expect(await world.app.entries.listBySeason(SEASON)).toEqual(entries);
    expect(await world.app.seasons.get(SEASON)).toEqual(season);
  });
});

describe("dismissNudge (REQ-N4)", () => {
  it("hides the case for good: the viewer is offered nothing that day or after", async () => {
    const world = await given();
    expect(await dismiss(world)).toEqual({ ok: true, value: undefined });
    expect((await feedFor(world, "victor")).nudge).toBeNull();
    expect((await feedFor(world, "victor", DAY + 1)).nudge).toBeNull();
    const [stored] = await world.app.nudgeDismissals.listMine(SEASON, VICTOR);
    expect(stored).toMatchObject({
      viewerId: VICTOR,
      targetId: ANDREA,
      caseWeek: 1,
      dismissedOn: dateOfDay(DAY),
    });
  });

  it("is idempotent, also on a later day, and keeps the first dismissal", async () => {
    const world = await given();
    await dismiss(world);
    expect(await dismiss(world)).toEqual({ ok: true, value: undefined });
    expect(await dismiss(world, {}, DAY + 3)).toEqual({ ok: true, value: undefined });
    const stored = await world.app.nudgeDismissals.listMine(SEASON, VICTOR);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.dismissedOn).toBe(dateOfDay(DAY));
  });

  it.each([
    ["a week that is not the live one", { week: 2 }],
    ["the viewer themself", { targetId: VICTOR }],
    ["a member who is not in the circle", { targetId: memberId("member-nobody") }],
  ])("refuses %s as not available and stores nothing", async (_name, overrides) => {
    const world = await given();
    expect(await dismiss(world, overrides)).toEqual({
      ok: false,
      error: { kind: "NudgeNotAvailable" },
    });
    expect(await world.app.nudgeDismissals.listMine(SEASON, VICTOR)).toEqual([]);
  });

  it("refuses a case that was already answered with an encouragement", async () => {
    const world = await given();
    await send(world);
    expect(await dismiss(world, {}, DAY + 1)).toEqual({
      ok: false,
      error: { kind: "NudgeNotAvailable" },
    });
  });

  it("refuses an unknown season and a stranger", async () => {
    const world = await given();
    expect(await dismiss(world, { seasonId: seasonId("nope") })).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
    expect(
      await dismissNudge(
        world.at(DAY),
        { userId: userId("stranger") },
        {
          seasonId: SEASON,
          targetId: ANDREA,
          week: 1,
        },
      ),
    ).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });
});

describe("the received encouragement (REQ-N8)", () => {
  it("shows the recipient 'X te envió 🙌' as a feed item, and nothing about the week", async () => {
    const world = await given();
    await send(world);
    const [stored] = await world.app.encouragements.listSent(SEASON, VICTOR);
    const feed = await feedFor(world, "andrea");
    const received = feed.items.find((i) => i.kind === "encouragementReceived");
    expect(received).toEqual({
      kind: "encouragementReceived",
      key: `encouragement:${stored?.id}`,
      onDate: dateOfDay(DAY),
      at: localInstant(dateOfDay(DAY)),
      senderId: VICTOR,
      emoji: "raisedHands",
    });
    const json = JSON.stringify(received);
    for (const word of ["week", "hard", "Meditar", "consistency", "caseWeek", "habit"]) {
      expect(json).not.toContain(word);
    }
  });

  it("is invisible to the sender and to everyone else", async () => {
    const world = await given();
    await send(world);
    expect(
      (await feedFor(world, "victor")).items.some((i) => i.kind === "encouragementReceived"),
    ).toBe(false);
  });

  it("cannot be reacted to", async () => {
    const world = await given();
    await send(world);
    const [stored] = await world.app.encouragements.listSent(SEASON, VICTOR);
    expect(
      await reactToFeedItem(world.at(DAY), world.andrea, {
        seasonId: SEASON,
        itemKey: `encouragement:${stored?.id}`,
        emoji: "heart",
      }),
    ).toEqual({ ok: false, error: { kind: "FeedItemNotFound" } });
  });

  it("pages and sorts like any other item", async () => {
    const world = await given();
    await send(world);
    const items = (await feedFor(world, "andrea")).items;
    const received = items.findIndex((i) => i.kind === "encouragementReceived");
    const started = items.findIndex((i) => i.kind === "seasonStarted");
    expect(received).toBeGreaterThanOrEqual(0);
    expect(received).toBeLessThan(started);
  });
});
