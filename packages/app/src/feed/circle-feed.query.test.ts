import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { seedPause } from "../pause/pause-seed.ts";
import { givenReviewWorld, logMinutes } from "../review/review-fixtures.ts";
import { circleId, pauseRequestId, seasonId, userId } from "../shared/ids.ts";
import { memberFixture, pauseRequestFixture, seasonFixture } from "../testing/builders.ts";
import { localInstant } from "../testing/entry-fixtures.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { circleFeed } from "./circle-feed.query.ts";
import { dateOf } from "./feed-fixtures.ts";

const NO_CURSOR = {};

async function feedAt(
  world: Awaited<ReturnType<typeof givenReviewWorld>>,
  day: number,
  who: "victor" | "andrea" = "victor",
) {
  const result = await circleFeed(world.at(day), world[who], NO_CURSOR);
  if (!result.ok) throw new Error(`feed failed: ${result.error.kind}`);
  return result.value;
}

describe("circleFeed: which season it shows (F2)", () => {
  it("is empty for a user with no circle, without error", async () => {
    const world = await givenReviewWorld();
    const result = await circleFeed(world.at(2), { userId: userId("stranger") }, NO_CURSOR);
    expect(result).toEqual({
      ok: true,
      value: { seasonId: null, members: [], items: [], nextCursor: null, nudge: null },
    });
  });

  it("is empty, with the members, while the circle has no started season", async () => {
    const world = await givenReviewWorld();
    await world.app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(seasonId("season-1"));
      if (!season) throw new Error("no season");
      await repos.seasons.save(
        { ...season, status: "pactOpen", actualStart: null, version: season.version + 1 },
        season.version,
      );
      return { ok: true as const, value: undefined };
    });
    const feed = await feedAt(world, 2);
    expect(feed.seasonId).toBeNull();
    expect(feed.items).toEqual([]);
    expect(feed.members.map((m) => m.displayName)).toEqual(["Andrea", "Victor"]);
  });

  it("shows the season's start on day 1 and nothing else yet", async () => {
    const world = await givenReviewWorld();
    const feed = await feedAt(world, 1);
    expect(feed.seasonId).toBe("season-1");
    expect(feed.items.map((i) => i.kind)).toEqual(["seasonStarted"]);
    expect(feed.nextCursor).toBeNull();
  });

  it("keeps showing the closing season while the next one only has its pact open", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await world.app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(seasonId("season-1"));
      if (!season) throw new Error("no season");
      await repos.seasons.save(
        { ...season, status: "closed", version: season.version + 1 },
        season.version,
      );
      await repos.seasons.save(
        seasonFixture({
          id: seasonId("season-2"),
          circleId: circleId("circle-1"),
          nominalStart: localDate("2026-11-20"),
        }),
        null,
      );
      return { ok: true as const, value: undefined };
    });
    const feed = await feedAt(world, 35);
    expect(feed.seasonId).toBe("season-1");
    expect(feed.items.map((i) => i.kind)).toEqual(
      expect.arrayContaining(["seasonClosed", "seasonStarted"]),
    );
  });

  it("skips a season whose start day is still in the future", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await world.app.uow.transaction(async (repos) => {
      const first = await repos.seasons.get(seasonId("season-1"));
      if (!first) throw new Error("no season");
      await repos.seasons.save(
        { ...first, status: "closed", version: first.version + 1 },
        first.version,
      );
      await repos.seasons.save(
        seasonFixture({
          id: seasonId("season-2"),
          circleId: circleId("circle-1"),
          status: "active",
          nominalStart: localDate("2026-12-01"),
          actualStart: localDate("2026-12-01"),
          pactClosedAt: instant(1),
        }),
        null,
      );
      return { ok: true as const, value: undefined };
    });
    expect((await feedAt(world, 35)).seasonId).toBe("season-1");
  });
});

describe("circleFeed: members and items for the viewer", () => {
  it("lists the circle's members with who is the viewer and who left", async () => {
    const world = await givenReviewWorld();
    await world.app.uow.transaction(async (repos) => {
      const circle = await repos.circles.get(circleId("circle-1"));
      if (!circle) throw new Error("no circle");
      const members = circle.members.map((m) =>
        m.displayName === "Andrea" ? memberFixture({ ...m, status: "left" }) : m,
      );
      await repos.circles.save({ ...circle, members, version: circle.version + 1 }, circle.version);
      return { ok: true as const, value: undefined };
    });
    const feed = await feedAt(world, 2);
    // A member who left is not named in the feed any more (ADR-0018).
    expect(feed.members).toEqual([
      { id: expect.anything(), displayName: null, isYou: false, left: true },
      expect.objectContaining({ displayName: "Victor", isYou: true, left: false }),
    ]);
    expect(JSON.stringify(feed.members)).not.toContain("Andrea");
  });

  it("shows a peer's kept session, newest first, with the value of a visible commitment", async () => {
    const world = await givenReviewWorld();
    await logMinutes(world, "meditar", 0, "30");
    await logMinutes(world, "meditar", 1, "25");
    const feed = await feedAt(world, 3);
    const completed = feed.items.filter((i) => i.kind === "completed");
    expect(completed.map((i) => i.onDate)).toEqual([dateOf(1), dateOf(0)]);
    expect(completed[0]).toMatchObject({
      memberId: "member-andrea",
      subject: { kind: "habit", name: "Meditar" },
      value: { amount: "25", unit: "minutes" },
      reactions: { reactable: true, mine: null },
    });
  });

  it("masks Andrea's private commitment for Victor and not for Andrea", async () => {
    const world = await givenReviewWorld();
    await world.app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(seasonId("season-1"));
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
    await logMinutes(world, "meditar", 0, "30");
    const forVictor = (await feedAt(world, 2, "victor")).items.find((i) => i.kind === "completed");
    const forAndrea = (await feedAt(world, 2, "andrea")).items.find((i) => i.kind === "completed");
    expect(forVictor).toMatchObject({ subject: { kind: "private" }, value: null });
    expect(forAndrea).toMatchObject({
      subject: { kind: "habit", name: "Meditar" },
      value: { amount: "30" },
      reactions: { reactable: false },
    });
  });

  it("derives a pending pause that passed its deadline as approved, at the deadline", async () => {
    const world = await givenReviewWorld();
    const requestedAt = localInstant(dateOf(1));
    await seedPause(
      world.app,
      pauseRequestFixture({
        id: pauseRequestId("pause-late"),
        seasonId: seasonId("season-1"),
        memberId: memberId("member-andrea"),
        requestedAt,
        requestedOn: seasonDay(1),
        startDay: seasonDay(1),
        autoApproveAt: instant(requestedAt + 48 * 3_600_000),
        commitments: [{ commitmentId: world.meditar, resumedOn: null, resumedAt: null }],
      }),
    );
    expect((await feedAt(world, 2)).items.some((i) => i.kind === "paused")).toBe(false);
    const feed = await feedAt(world, 4);
    expect(feed.items.find((i) => i.kind === "paused")).toMatchObject({
      key: "pause:pause-late",
      onDate: dateOf(3),
      at: instant(requestedAt + 48 * 3_600_000),
    });
  });

  it("does not write when it reads", async () => {
    const world = await givenReviewWorld();
    await logMinutes(world, "meditar", 0, "30");
    const season = await world.app.seasons.get(seasonId("season-1"));
    const entries = await world.app.entries.listBySeason(seasonId("season-1"));
    await feedAt(world, 3);
    await feedAt(world, 3);
    expect(await world.app.seasons.get(seasonId("season-1"))).toEqual(season);
    expect(await world.app.entries.listBySeason(seasonId("season-1"))).toEqual(entries);
    expect(await world.app.feedReactions.listBySeason(seasonId("season-1"))).toEqual([]);
  });
});

describe("circleFeed: paging (F10)", () => {
  it("returns 20 items and a cursor, then the rest, with no repeat", async () => {
    const world = await givenReviewWorld();
    for (let day = 0; day < 30; day++) await logMinutes(world, "meditar", day, "30");
    const first = await circleFeed(world.at(32), world.victor, NO_CURSOR);
    if (!first.ok) throw new Error("first page");
    expect(first.value.items).toHaveLength(20);
    expect(first.value.nextCursor).not.toBeNull();
    const second = await circleFeed(world.at(32), world.victor, { cursor: first.value.nextCursor });
    if (!second.ok) throw new Error("second page");
    const keys = [...first.value.items, ...second.value.items].map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(second.value.items.length).toBeGreaterThan(10);
    expect(second.value.nextCursor).toBeNull();
  });

  it("refuses a cursor that is not ours", async () => {
    const world = await givenReviewWorld();
    const result = await circleFeed(world.at(2), world.victor, { cursor: "not-a-cursor" });
    expect(result).toEqual({ ok: false, error: { kind: "InvalidFeedCursor" } });
  });

  it("refuses a bad cursor even for a user with no circle", async () => {
    const world = await givenReviewWorld();
    const result = await circleFeed(world.at(2), { userId: userId("stranger") }, { cursor: "!" });
    expect(result).toEqual({ ok: false, error: { kind: "InvalidFeedCursor" } });
  });
});
