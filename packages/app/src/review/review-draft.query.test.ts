import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { seasonId, userId } from "../shared/ids.ts";
import { reviewDraft } from "./review-draft.query.ts";
import { dateOfDay, givenReviewWorld, logMinutes } from "./review-fixtures.ts";
import { submitReview } from "./submit-review.ts";

const SEASON = seasonId("season-1");
const ANDREA = memberId("member-andrea");

describe("reviewDraft", () => {
  it("SC-01: the due interim review of period 1 with its live summary", async () => {
    const world = await givenReviewWorld();
    await logMinutes(world, "meditar", 0);
    const result = await reviewDraft(world.at(15), world.andrea, {
      seasonId: SEASON,
      periodIndex: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      status: "due",
      kind: "interim",
      srbai: "item1",
      weeks: { first: 1, last: 2 },
      dueUntil: dateOfDay(28),
      commitments: [
        { commitmentId: world.meditar, habitName: "Meditar", icon: "book", paused: false },
        { commitmentId: world.leer, habitName: "Leer", icon: "book", paused: false },
      ],
    });
    expect(result.value.summary?.commitments).toHaveLength(2);
    expect(result.value.summary?.commitments[0]).toMatchObject({ kept: 1, habitName: "Meditar" });
  });

  it("SC-07: reading it stores nothing", async () => {
    const world = await givenReviewWorld();
    await reviewDraft(world.at(15), world.andrea, { seasonId: SEASON, periodIndex: 1 });
    await reviewDraft(world.at(15), world.andrea, { seasonId: SEASON, periodIndex: 1 });
    expect(await world.app.reviews.listMine(SEASON, ANDREA)).toEqual([]);
  });

  it("an upcoming period reports its status and no summary yet", async () => {
    const world = await givenReviewWorld();
    const result = await reviewDraft(world.at(15), world.andrea, {
      seasonId: SEASON,
      periodIndex: 2,
    });
    expect(result.ok && result.value).toMatchObject({
      status: "upcoming",
      kind: "interim",
      srbai: "full",
      summary: null,
    });
  });

  it("a lapsed period still reads, so the web can say so", async () => {
    const world = await givenReviewWorld();
    const result = await reviewDraft(world.at(29), world.andrea, {
      seasonId: SEASON,
      periodIndex: 1,
    });
    expect(result.ok && result.value.status).toBe("lapsed");
  });

  it("a submitted period reads as completed", async () => {
    const world = await givenReviewWorld();
    await submitReview(world.at(16), world.andrea, {
      seasonId: SEASON,
      periodIndex: 1,
      reflection: { helped: null, hard: null },
      automaticity: [
        { commitmentId: world.meditar, items: [4, null, null, null] },
        { commitmentId: world.leer, items: [4, null, null, null] },
      ],
    });
    const result = await reviewDraft(world.at(17), world.andrea, {
      seasonId: SEASON,
      periodIndex: 1,
    });
    expect(result.ok && result.value.status).toBe("completed");
  });

  it("the baseline has no weeks, no summary and a full SRBAI", async () => {
    const world = await givenReviewWorld();
    const result = await reviewDraft(world.at(3), world.andrea, {
      seasonId: SEASON,
      periodIndex: 0,
    });
    expect(result.ok && result.value).toMatchObject({
      status: "due",
      kind: "baseline",
      srbai: "full",
      weeks: null,
      summary: null,
      dueUntil: dateOfDay(7),
    });
  });

  it("the closing review covers the last weeks and never lapses", async () => {
    const world = await givenReviewWorld();
    const result = await reviewDraft(world.at(70), world.andrea, {
      seasonId: SEASON,
      periodIndex: 4,
    });
    expect(result.ok && result.value).toMatchObject({
      status: "due",
      kind: "closing",
      weeks: { first: 7, last: 8 },
      dueUntil: null,
    });
  });

  it("SC-70/73: only a commitment paused on the review day is tagged", async () => {
    const world = await givenReviewWorld();
    // Meditar paused through 0-based day 10 (ended before day 15); Leer paused from day 12 on.
    await world.app.pauses.seed(SEASON, {
      memberId: ANDREA,
      commitmentId: world.meditar,
      requestedOn: seasonDay(0),
      startDay: seasonDay(2),
      end: { kind: "fixed", lastDay: seasonDay(10) },
      decision: { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
    });
    await world.app.pauses.seed(SEASON, {
      memberId: ANDREA,
      commitmentId: world.leer,
      requestedOn: seasonDay(0),
      startDay: seasonDay(12),
      end: { kind: "open" },
      decision: { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
    });
    const result = await reviewDraft(world.at(15), world.andrea, {
      seasonId: SEASON,
      periodIndex: 1,
    });
    expect(result.ok && result.value.commitments.map((c) => [c.habitName, c.paused])).toEqual([
      ["Meditar", false],
      ["Leer", true],
    ]);
  });

  it("SC-102: a member sees only their own commitments, private ones included", async () => {
    const world = await givenReviewWorld({ privateLeer: true });
    const own = await reviewDraft(world.at(15), world.andrea, { seasonId: SEASON, periodIndex: 1 });
    expect(own.ok && own.value.commitments.map((c) => c.habitName)).toEqual(["Meditar", "Leer"]);
    const peer = await reviewDraft(world.at(15), world.victor, {
      seasonId: SEASON,
      periodIndex: 1,
    });
    expect(peer.ok && peer.value.commitments.map((c) => c.habitName)).toEqual(["Correr"]);
    expect(JSON.stringify(peer)).not.toContain("Leer");
  });

  it("is refused for strangers, unknown seasons, an open pact and missing periods", async () => {
    const world = await givenReviewWorld();
    const ask = (actor = world.andrea, season = SEASON, periodIndex = 1) =>
      reviewDraft(world.at(15), actor, { seasonId: season, periodIndex });
    expect(await ask({ userId: userId("user-stranger") })).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
    expect(await ask(world.andrea, seasonId("nope"))).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
    expect(await ask(world.andrea, SEASON, 5)).toEqual({
      ok: false,
      error: { kind: "ReviewPeriodNotFound" },
    });
    await world.app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(SEASON);
      if (!season) throw new Error("no season");
      await repos.seasons.save(
        { ...season, status: "pactOpen", actualStart: null, pactClosedAt: null, version: 1 },
        0,
      );
      return { ok: true, value: undefined };
    });
    expect(await ask()).toEqual({ ok: false, error: { kind: "SeasonNotActive" } });
  });
});
