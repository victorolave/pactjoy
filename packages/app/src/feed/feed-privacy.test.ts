import { fromInt, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { leaveCircle } from "../circle/leave-circle.ts";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import { seedPause } from "../pause/pause-seed.ts";
import { reactToFeedItem } from "../reaction/react-to-feed-item.ts";
import { givenReviewWorld, type ReviewWorld } from "../review/review-fixtures.ts";
import { seedReview } from "../review/review-seed.ts";
import { seedClosure } from "../season/closure/closure-seed.ts";
import {
  circleId,
  entryPhotoId,
  habitId,
  pauseRequestId,
  reviewId,
  seasonId,
  userId,
} from "../shared/ids.ts";
import {
  habitFixture,
  pauseRequestFixture,
  reviewFixture,
  seasonClosureFixture,
} from "../testing/builders.ts";
import { localInstant } from "../testing/entry-fixtures.ts";
import { instant } from "../time/instant.ts";
import { circleFeed } from "./circle-feed.query.ts";
import { ANDREA, dateOf, minutes } from "./feed-fixtures.ts";

/**
 * The privacy sentinel of the feed (REQ-X1, ADR-0018): everything Andrea keeps private is seeded
 * with a recognizable marker, the feed and the reaction answers a peer receives are serialized,
 * and not one marker (nor a field that could carry one) may appear. It runs again after Andrea
 * leaves the circle, when her items stay but must stay masked.
 */
const SEASON = seasonId("season-1");
const SECRET = commitmentId("commitment-secret");
const SECRET_HABIT = habitId("habit-secret");

const MARKERS = [
  "SENTINEL_HABIT",
  "SENTINEL_LABEL",
  "SENTINEL_NOTE",
  "SENTINEL_PHOTO",
  "SENTINEL_WHY",
  "SENTINEL_CATEGORY",
  "SENTINEL_PAUSE_NOTE",
  "SENTINEL_REFLECTION",
  "sentinel-icon",
  "7.25",
];
/** Field names that must never exist in a peer's payload. */
const FORBIDDEN_FIELDS = [
  "note",
  "photoId",
  "photo",
  "objectKey",
  "userId",
  "reflection",
  "decisions",
  "srbai",
];

/**
 * Andrea's PRIVATE commitment "SENTINEL_HABIT" (custom unit, 7.25 a day with a note and a photo)
 * on top of the review world, with a comeback, a consistent week, an approved pause with a
 * note, a graduation, a review with a reflection and a closure with decisions around it.
 */
async function givenSecretWorld(): Promise<ReviewWorld> {
  const world = await givenReviewWorld({ lengthWeeks: 8 });
  const secret = buildCommitment({
    id: SECRET,
    memberId: ANDREA,
    habitId: SECRET_HABIT,
    weightPercent: 1,
    privacy: "private",
    measure: {
      unit: "custom",
      customLabel: "SENTINEL_LABEL",
      precision: "decimal",
      target: { direction: "reach", minimum: fromInt(5), ideal: fromInt(10) },
      schedule: {
        period: "perSession",
        frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      },
    },
  });
  // Week 1 complete, then four silent days (8-11) and a return on day 12: a comeback.
  const days = [0, 1, 2, 3, 4, 5, 6, 7, 12, 13];
  const entries = days.map((day) => ({
    ...minutes(secret, day, "7.25"),
    memberId: secret.memberId,
    note: "SENTINEL_NOTE",
    photoId: entryPhotoId("SENTINEL_PHOTO"),
  }));
  await world.app.uow.transaction(async (repos) => {
    const season = await repos.seasons.get(SEASON);
    if (!season) throw new Error("no season");
    await repos.seasons.save(
      { ...season, commitments: [...season.commitments, secret], version: season.version + 1 },
      season.version,
    );
    await repos.habits.save(
      habitFixture({
        id: SECRET_HABIT,
        ownerId: userId("user-andrea"),
        name: "SENTINEL_HABIT",
        why: "SENTINEL_WHY",
        category: "SENTINEL_CATEGORY",
        icon: "sentinel-icon",
        graduatedAt: localInstant(dateOf(16)),
      }),
      null,
    );
    for (const entry of entries) await repos.entries.add(entry);
    return { ok: true as const, value: undefined };
  });
  // The private stores are seeded through the helpers their own modules provide.
  await seedPause(
    world.app,
    pauseRequestFixture({
      id: pauseRequestId("pause-secret"),
      seasonId: SEASON,
      memberId: secret.memberId,
      note: "SENTINEL_PAUSE_NOTE",
      status: "approved",
      requestedAt: localInstant(dateOf(15)),
      requestedOn: seasonDay(15),
      startDay: seasonDay(15),
      decidedAt: localInstant(dateOf(15)),
      decidedOn: seasonDay(15),
      commitments: [{ commitmentId: SECRET, resumedOn: null, resumedAt: null }],
    }),
  );
  await seedReview(
    world.app,
    reviewFixture({
      id: reviewId("review-secret"),
      seasonId: SEASON,
      memberId: secret.memberId,
      reflection: { helped: "SENTINEL_REFLECTION", hard: "SENTINEL_REFLECTION" },
    }),
  );
  await seedClosure(
    world.app,
    seasonClosureFixture({
      seasonId: SEASON,
      memberId: secret.memberId,
      decisions: [{ commitmentId: SECRET, decision: "graduate" }],
      decidedAt: instant(1),
    }),
  );
  return world;
}

const DAY = 20;

async function victorsFeed(world: ReviewWorld) {
  const feed = await circleFeed(world.at(DAY), world.victor, {});
  if (!feed.ok) throw new Error(`feed failed: ${feed.error.kind}`);
  return feed.value;
}

/** Every key at any depth of a JSON-able value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
  }
  return [];
}

function expectClean(payload: unknown) {
  const json = JSON.stringify(payload);
  for (const marker of MARKERS) expect(json, `marker ${marker}`).not.toContain(marker);
  const keys = new Set(keysOf(payload));
  for (const field of FORBIDDEN_FIELDS) expect(keys.has(field), `field ${field}`).toBe(false);
  expect(json).not.toContain("user-andrea");
}

describe("the feed leaks nothing private to a peer (REQ-X1)", () => {
  it("seeds every kind of item about the private commitment", async () => {
    const feed = await victorsFeed(await givenSecretWorld());
    const kinds = new Set(feed.items.map((i) => i.kind));
    expect(kinds).toEqual(
      new Set([
        "completed",
        "consistentWeek",
        "comeback",
        "paused",
        "pointsRecalculated",
        "graduated",
        "seasonStarted",
      ]),
    );
  });

  it("the feed Victor reads has no marker and no private field", async () => {
    const feed = await victorsFeed(await givenSecretWorld());
    expectClean(feed);
    const about = feed.items.filter((i) => "subject" in i || "subjects" in i);
    expect(about.length).toBeGreaterThan(0);
    for (const item of feed.items) {
      if ("subject" in item) expect(item.subject).toEqual({ kind: "private" });
      if ("subjects" in item) expect(item.subjects).toEqual([{ kind: "private" }]);
      if (item.kind === "completed") expect(item.value).toBeNull();
      if (item.kind === "consistentWeek") expect([item.kept, item.counted]).toEqual([null, null]);
      if (item.kind === "paused") expect(item.reason).toBeNull();
    }
  });

  it("the reactions answer on a private item shows counts only", async () => {
    const world = await givenSecretWorld();
    const feed = await victorsFeed(world);
    const item = feed.items.find((i) => i.kind === "completed");
    if (!item) throw new Error("no completed item");
    const answer = await reactToFeedItem(world.at(DAY), world.victor, {
      seasonId: SEASON,
      itemKey: item.key,
      emoji: "fire",
    });
    expect(answer).toMatchObject({ ok: true });
    expectClean(answer);
    if (answer.ok) {
      expect(Object.keys(answer.value).sort()).toEqual(["counts", "mine", "reactable"]);
    }
    const after = await victorsFeed(world);
    expectClean(after);
    const reacted = after.items.find((i) => i.key === item.key);
    expect(reacted && "reactions" in reacted && Object.keys(reacted.reactions).sort()).toEqual([
      "counts",
      "mine",
      "reactable",
    ]);
  });

  it("stays masked, and stays clean, after Andrea leaves the circle", async () => {
    const world = await givenSecretWorld();
    await leaveCircle(world.at(DAY), world.andrea, { circleId: circleId("circle-1") });
    const feed = await victorsFeed(world);
    expect(feed.items.some((i) => i.kind === "completed")).toBe(true);
    expectClean(feed);
    for (const item of feed.items) {
      if ("reactions" in item && "memberId" in item && item.memberId === "member-andrea") {
        expect(item.reactions.reactable).toBe(false);
      }
    }
  });

  it("the owner still sees their own private commitment in full", async () => {
    const world = await givenSecretWorld();
    const feed = await circleFeed(world.at(DAY), world.andrea, {});
    if (!feed.ok) throw new Error("feed");
    expect(JSON.stringify(feed.value)).toContain("SENTINEL_HABIT");
    expect(JSON.stringify(feed.value)).not.toContain("SENTINEL_NOTE");
    expect(JSON.stringify(feed.value)).not.toContain("SENTINEL_PHOTO");
  });
});
