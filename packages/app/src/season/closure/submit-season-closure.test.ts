import { describe, expect, it } from "vitest";
import { memberId } from "../../circle/circle.ts";
import { leaveCircle } from "../../circle/leave-circle.ts";
import { recordEntry } from "../../entry/record-entry.ts";
import { dateOfDay, givenReviewWorld, type ReviewWorld } from "../../review/review-fixtures.ts";
import { memberScore } from "../../score/member-score.query.ts";
import { ConcurrencyConflict } from "../../shared/errors.ts";
import { circleId, habitId, userId } from "../../shared/ids.ts";
import { raceTransactions } from "../../testing/race-harness.ts";
import { instant } from "../../time/instant.ts";
import { createSeason } from "../create-season.ts";
import { storedClosedIds, storedClosure } from "./closure-fixtures.ts";
import { answerClosingReview, decideAll, SEASON, submitClosureAs } from "./closure-world.ts";
import { submitSeasonClosure } from "./submit-season-closure.ts";

const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");

const season = (world: ReviewWorld) => world.app.uow.read((repos) => repos.seasons.get(SEASON));
const habit = (world: ReviewWorld, id: string) =>
  world.app.uow.read((repos) => repos.habits.get(habitId(id)));

/** Both members have answered their closing reviews on the grace day. */
async function givenClosingReviewsDone(options: Parameters<typeof givenReviewWorld>[0] = {}) {
  const world = await givenReviewWorld({ lengthWeeks: 4, ...options });
  await answerClosingReview(world, "andrea");
  await answerClosingReview(world, "victor");
  return world;
}

describe("submitSeasonClosure: the happy path", () => {
  it("SC-C1: stores one closure with a decision per commitment and the clock's instant", async () => {
    const world = await givenClosingReviewsDone();
    const decisions = [
      { commitmentId: world.meditar, decision: "continue" },
      { commitmentId: world.leer, decision: "pause" },
    ];

    const result = await submitClosureAs(world, "andrea", 30, decisions);

    expect(result.ok).toBe(true);
    const stored = await storedClosure(world.app, SEASON, ANDREA);
    expect(stored).toMatchObject({
      seasonId: SEASON,
      memberId: ANDREA,
      decisions,
      decidedAt: world.at(30).clock.now(),
      version: 0,
    });
    if (result.ok) {
      expect(result.value).toMatchObject({ graduatedHabitIds: [], seasonClosed: false });
      expect(result.value.closure).toEqual(stored);
    }
  });

  it("SC-F2: the last participant to close finalizes the season in the same transaction", async () => {
    const world = await givenClosingReviewsDone();
    await submitClosureAs(world, "andrea", 30);
    expect((await season(world))?.status).toBe("active");

    const result = await submitClosureAs(world, "victor", 30);

    expect(result.ok && result.value.seasonClosed).toBe(true);
    expect(await season(world)).toMatchObject({ status: "closed", version: 1 });
  });

  it("not the last: the season stays active and unversioned", async () => {
    const world = await givenClosingReviewsDone();
    await submitClosureAs(world, "victor", 31);
    expect(await season(world)).toMatchObject({ status: "active", version: 0 });
  });

  it("SC-F3: a participant who left does not hold the season: the remaining one closes it", async () => {
    const world = await givenClosingReviewsDone();
    expect(
      (await leaveCircle(world.at(5), world.victor, { circleId: circleId("circle-1") })).ok,
    ).toBe(true);
    const result = await submitClosureAs(world, "andrea", 30);
    expect(result.ok && result.value.seasonClosed).toBe(true);
    expect((await season(world))?.status).toBe("closed");
  });

  it("SC-F4: a member with no commitments is not waited for", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4, andreaWithoutCommitments: true });
    await answerClosingReview(world, "victor");
    const result = await submitClosureAs(world, "victor", 30);
    expect(result.ok && result.value.seasonClosed).toBe(true);
    expect(await storedClosedIds(world.app, SEASON)).toEqual([VICTOR]);
  });

  it("REQ-C7: points, entries and the commitments are untouched", async () => {
    const world = await givenClosingReviewsDone();
    const logged = await recordEntry(world.at(5), world.andrea, {
      seasonId: SEASON,
      commitmentId: world.meditar,
      forDate: dateOfDay(5),
      value: { kind: "quantity", value: "30" },
      clientRequestId: "x-1",
    });
    expect(logged.ok).toBe(true);
    const scoreOf = async () => memberScore(world.at(30), world.andrea, { seasonId: SEASON });
    const before = await scoreOf();
    const entriesBefore = await world.app.entries.listBySeason(SEASON);
    const commitmentsBefore = (await season(world))?.commitments;

    await submitClosureAs(world, "andrea", 30, decideAll(world, "andrea", "graduate"));

    expect(await scoreOf()).toEqual(before);
    expect(await world.app.entries.listBySeason(SEASON)).toEqual(entriesBefore);
    expect((await season(world))?.commitments).toEqual(commitmentsBefore);
  });
});

describe("submitSeasonClosure: rejections store nothing", () => {
  const nothingStored = async (world: ReviewWorld) =>
    expect(await storedClosedIds(world.app, SEASON)).toEqual([]);

  it("SC-C2: the closing review has not been submitted", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    expect(await submitClosureAs(world, "andrea", 30)).toEqual({
      ok: false,
      error: { kind: "ClosingReviewRequired" },
    });
    await nothingStored(world);
  });

  it("SC-C3: a second submission is refused and the first stays intact", async () => {
    const world = await givenClosingReviewsDone();
    await submitClosureAs(world, "andrea", 30);
    const first = await storedClosure(world.app, SEASON, ANDREA);

    const again = await submitClosureAs(world, "andrea", 31, decideAll(world, "andrea", "pause"));

    expect(again).toEqual({ ok: false, error: { kind: "ClosureAlreadySubmitted" } });
    expect(await storedClosure(world.app, SEASON, ANDREA)).toEqual(first);
  });

  it("SC-C4: a missing, repeated, foreign or invalid decision", async () => {
    const world = await givenClosingReviewsDone();
    const only = (commitmentId: typeof world.meditar, decision = "continue") => ({
      commitmentId,
      decision,
    });
    const cases = [
      [[only(world.meditar)], { kind: "ClosureIncomplete", commitmentIds: [world.leer] }],
      [
        [only(world.meditar), only(world.meditar), only(world.leer)],
        { kind: "InvalidClosureDecision", commitmentId: world.meditar },
      ],
      [
        [only(world.meditar), only(world.leer), only(world.victorRun)],
        { kind: "CommitmentNotOwned" },
      ],
      [
        [only(world.meditar), only(world.leer, "maybe")],
        { kind: "InvalidClosureDecision", commitmentId: world.leer },
      ],
    ] as const;
    for (const [decisions, error] of cases) {
      expect(await submitClosureAs(world, "andrea", 30, decisions)).toEqual({ ok: false, error });
    }
    await nothingStored(world);
  });

  it("SC-C5: before the results day (including the grace day) it is refused with the date", async () => {
    const world = await givenClosingReviewsDone();
    for (const n of [10, 28, 29]) {
      expect(await submitClosureAs(world, "andrea", n)).toEqual({
        ok: false,
        error: { kind: "SeasonResultsNotYet", availableOn: dateOfDay(30) },
      });
    }
    await nothingStored(world);
  });

  it("SC-C6: someone outside the circle, and an unknown season", async () => {
    const world = await givenClosingReviewsDone();
    const stranger = { userId: userId("user-nobody") };
    expect(
      await submitSeasonClosure(world.at(30), stranger, { seasonId: SEASON, decisions: [] }),
    ).toEqual({ ok: false, error: { kind: "NotAMember" } });
    expect(
      await submitSeasonClosure(world.at(30), world.andrea, {
        seasonId: "nope" as typeof SEASON,
        decisions: [],
      }),
    ).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
  });

  it("a member with no commitments has nothing to close", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4, andreaWithoutCommitments: true });
    expect(await submitClosureAs(world, "andrea", 30, [])).toEqual({
      ok: false,
      error: { kind: "NothingToClose" },
    });
  });

  it("a season that is already closed is SeasonNotActive", async () => {
    const world = await givenClosingReviewsDone();
    await submitClosureAs(world, "andrea", 30);
    await submitClosureAs(world, "victor", 30);
    expect(await submitClosureAs(world, "andrea", 31)).toEqual({
      ok: false,
      error: { kind: "SeasonNotActive" },
    });
  });
});

describe("submitSeasonClosure: graduation", () => {
  it("SC-G1: a graduate decision stamps the habit with the decision instant, and only that habit", async () => {
    const world = await givenClosingReviewsDone();
    const result = await submitClosureAs(world, "andrea", 30, [
      { commitmentId: world.meditar, decision: "graduate" },
      { commitmentId: world.leer, decision: "continue" },
    ]);

    expect(result.ok && result.value.graduatedHabitIds).toEqual(["habit-meditar"]);
    expect(await habit(world, "habit-meditar")).toMatchObject({
      graduatedAt: world.at(30).clock.now(),
      version: 1,
    });
    expect(await habit(world, "habit-leer")).toMatchObject({ graduatedAt: null, version: 0 });
  });

  it("an already graduated habit is left untouched and not reported", async () => {
    const world = await givenClosingReviewsDone();
    const before = await habit(world, "habit-meditar");
    if (!before) throw new Error("habit missing");
    await world.app.uow.transaction(async (repos) => {
      await repos.habits.save({ ...before, graduatedAt: instant(5), version: 1 }, 0);
      return { ok: true, value: undefined };
    });

    const result = await submitClosureAs(
      world,
      "andrea",
      30,
      decideAll(world, "andrea", "graduate"),
    );

    expect(result.ok && result.value.graduatedHabitIds).toEqual(["habit-leer"]);
    expect(await habit(world, "habit-meditar")).toMatchObject({
      graduatedAt: instant(5),
      version: 1,
    });
  });

  it("graduating a habit that is not the caller's is CommitmentNotOwned and graduates nothing", async () => {
    const world = await givenClosingReviewsDone();
    const leer = await habit(world, "habit-leer");
    if (!leer) throw new Error("habit missing");
    await world.app.uow.transaction(async (repos) => {
      await repos.habits.save({ ...leer, ownerId: world.victor.userId, version: 1 }, 0);
      return { ok: true, value: undefined };
    });

    const result = await submitClosureAs(
      world,
      "andrea",
      30,
      decideAll(world, "andrea", "graduate"),
    );

    expect(result).toEqual({ ok: false, error: { kind: "CommitmentNotOwned" } });
    expect(await habit(world, "habit-meditar")).toMatchObject({ graduatedAt: null, version: 0 });
    expect(await storedClosure(world.app, SEASON, ANDREA)).toBeNull();
  });

  it("SC-G2/REQ-G6: a rejection leaves every habit ungraduated", async () => {
    const world = await givenReviewWorld({ lengthWeeks: 4 });
    await submitClosureAs(world, "andrea", 30, decideAll(world, "andrea", "graduate"));
    expect(await habit(world, "habit-meditar")).toMatchObject({ graduatedAt: null });
  });
});

describe("submitSeasonClosure: races", () => {
  it("SC-F6: the two last closers at once: both closures exist and the season closes once", async () => {
    const world = await givenClosingReviewsDone();

    const { winner, loser } = await raceTransactions(
      world.at(30),
      (app) =>
        submitSeasonClosure(app, world.andrea, {
          seasonId: SEASON,
          decisions: decideAll(world, "andrea", "continue"),
        }),
      (app) =>
        submitSeasonClosure(app, world.victor, {
          seasonId: SEASON,
          decisions: decideAll(world, "victor", "continue"),
        }),
    );

    expect(winner.status).toBe("fulfilled");
    expect(loser.status).toBe("fulfilled");
    expect((await storedClosedIds(world.app, SEASON)).slice().sort()).toEqual([ANDREA, VICTOR]);
    expect(await season(world)).toMatchObject({ status: "closed", version: 1 });
  });

  it("SC-F7: createSeason finalized it first: the closure is refused and nothing is stored", async () => {
    const world = await givenClosingReviewsDone();
    const started = await createSeason(world.at(36), world.andrea, {
      circleId: circleId("circle-1"),
      timezone: "America/Santiago",
      startDate: dateOfDay(36),
      lengthWeeks: 4,
    });
    expect(started.ok).toBe(true);

    expect(await submitClosureAs(world, "victor", 36)).toEqual({
      ok: false,
      error: { kind: "SeasonNotActive" },
    });
    expect(await storedClosedIds(world.app, SEASON)).toEqual([]);
  });

  it("SC-F7: racing createSeason (winner) and a closure (loser): the closure conflicts and stores nothing", async () => {
    const world = await givenClosingReviewsDone();

    const { winner, loser } = await raceTransactions(
      world.at(36),
      (app) =>
        createSeason(app, world.andrea, {
          circleId: circleId("circle-1"),
          timezone: "America/Santiago",
          startDate: dateOfDay(36),
          lengthWeeks: 4,
        }),
      (app) =>
        submitSeasonClosure(app, world.victor, {
          seasonId: SEASON,
          decisions: decideAll(world, "victor", "continue"),
        }),
    );

    expect(winner.status).toBe("fulfilled");
    expect(loser.status).toBe("rejected");
    if (loser.status === "rejected") expect(loser.reason).toBeInstanceOf(ConcurrencyConflict);
    expect(await storedClosedIds(world.app, SEASON)).toEqual([]);
  });
});
