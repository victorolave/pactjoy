import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import { memberScore } from "../score/member-score.query.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { seasonId, userId } from "../shared/ids.ts";
import type { TestApp } from "../testing/app-harness.ts";
import { dateOfDay, givenReviewWorld, logMinutes, type ReviewWorld } from "./review-fixtures.ts";
import { type SubmitReviewInput, submitReview } from "./submit-review.ts";

const SEASON = seasonId("season-1");
const ANDREA = memberId("member-andrea");
const NO_REFLECTION = { helped: null, hard: null };

type Items = readonly (number | null)[];
const one = (n: number): Items => [n, null, null, null];

/** Item-1 answers for Andrea's two commitments, in season order. */
function itemOne(world: ReviewWorld, meditar = 4, leer = 3): SubmitReviewInput["automaticity"] {
  return [
    { commitmentId: world.meditar, items: one(meditar) },
    { commitmentId: world.leer, items: one(leer) },
  ];
}

function fullAnswers(
  world: ReviewWorld,
  meditar: Items = [4, 4, 5, 5],
  leer: Items = [3, 3, 3, 3],
): SubmitReviewInput["automaticity"] {
  return [
    { commitmentId: world.meditar, items: meditar },
    { commitmentId: world.leer, items: leer },
  ];
}

const submit = (
  app: TestApp,
  world: ReviewWorld,
  periodIndex: number,
  automaticity: SubmitReviewInput["automaticity"],
  reflection: SubmitReviewInput["reflection"] = NO_REFLECTION,
  actor = world.andrea,
) => submitReview(app, actor, { seasonId: SEASON, periodIndex, reflection, automaticity });

const stored = (world: ReviewWorld) => world.app.reviews.listMine(SEASON, ANDREA);

async function expectRejected(
  world: ReviewWorld,
  result: Awaited<ReturnType<typeof submitReview>>,
  error: unknown,
) {
  expect(result).toEqual({ ok: false, error });
  expect(await stored(world)).toEqual([]);
}

describe("submitReview: the happy path", () => {
  it("SC-63: stores the answers and the reflection, and nothing computed", async () => {
    const world = await givenReviewWorld();
    const app = world.at(16);
    const result = await submit(app, world, 1, itemOne(world), {
      helped: "  Con calma  ",
      hard: "   ",
    });

    expect(result.ok).toBe(true);
    const rows = await stored(world);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: rows[0]?.id,
      seasonId: SEASON,
      memberId: ANDREA,
      periodIndex: 1,
      kind: "interim",
      status: "completed",
      srbai: "item1",
      reflection: { helped: "Con calma", hard: null },
      responses: [
        { commitmentId: world.meditar, items: [4, null, null, null] },
        { commitmentId: world.leer, items: [3, null, null, null] },
      ],
      recordedAt: app.clock.now(),
      version: 0,
    });
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      "id kind memberId periodIndex recordedAt reflection responses seasonId srbai status version".split(
        " ",
      ),
    );
  });

  it("SC-80: no reflection at all is stored as absent fields", async () => {
    const world = await givenReviewWorld();
    await submit(world.at(15), world, 1, itemOne(world));
    expect((await stored(world))[0]?.reflection).toEqual(NO_REFLECTION);
  });

  it("answers come back in the member's season order whatever order they were sent in", async () => {
    const world = await givenReviewWorld();
    await submit(world.at(15), world, 1, [...itemOne(world)].reverse());
    expect((await stored(world))[0]?.responses.map((r) => r.commitmentId)).toEqual([
      world.meditar,
      world.leer,
    ]);
  });

  it("SC-72: works in a solo circle", async () => {
    const world = await givenReviewWorld({ solo: true });
    expect((await submit(world.at(15), world, 1, itemOne(world))).ok).toBe(true);
  });

  it("SC-104: submitting a review changes no points", async () => {
    const world = await givenReviewWorld();
    await logMinutes(world, "meditar", 0);
    const read = () => memberScore(world.at(15), world.andrea, { seasonId: SEASON });
    const before = await read();
    await submit(world.at(15), world, 1, itemOne(world));
    expect(await read()).toEqual(before);
  });

  it("the baseline is a full SRBAI with no reflection, and the member's private commitment is in it (SC-42)", async () => {
    const world = await givenReviewWorld({ privateLeer: true });
    const result = await submit(world.at(3), world, 0, fullAnswers(world), {
      helped: "ignored",
      hard: null,
    });
    expect(result.ok).toBe(true);
    const row = (await stored(world))[0];
    expect(row).toMatchObject({
      periodIndex: 0,
      kind: "baseline",
      srbai: "full",
      reflection: NO_REFLECTION,
    });
    expect(row?.responses.map((r) => r.commitmentId)).toEqual([world.meditar, world.leer]);
  });

  it("period 2 of 8 weeks / cadence 2 and the closing review are full", async () => {
    const world = await givenReviewWorld();
    expect((await submit(world.at(29), world, 2, fullAnswers(world))).ok).toBe(true);
    expect((await submit(world.at(57), world, 4, fullAnswers(world))).ok).toBe(true);
    expect((await stored(world)).map((r) => [r.periodIndex, r.kind, r.srbai])).toEqual([
      [2, "interim", "full"],
      [4, "closing", "full"],
    ]);
  });

  it("a paused commitment must still be answered, and can be (REQ-P1)", async () => {
    const world = await givenReviewWorld();
    await world.app.pauses.seed(SEASON, {
      memberId: ANDREA,
      commitmentId: world.meditar,
      requestedOn: seasonDay(0),
      startDay: seasonDay(0),
      end: { kind: "open" },
      decision: { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
    });
    await expectRejected(
      world,
      await submit(world.at(15), world, 1, [{ commitmentId: world.leer, items: one(3) }]),
      { kind: "AutomaticityIncomplete", commitmentIds: [world.meditar] },
    );
    expect((await submit(world.at(15), world, 1, itemOne(world))).ok).toBe(true);
  });
});

describe("submitReview: when a review can be submitted (REQ-S3, SC-84)", () => {
  it("not yet due: day 14 for period 1", async () => {
    const world = await givenReviewWorld();
    await expectRejected(world, await submit(world.at(14), world, 1, itemOne(world)), {
      kind: "ReviewNotDue",
      reason: "notYet",
    });
  });

  it("SC-03: lapsed once the next review is due (day 29 for period 1)", async () => {
    const world = await givenReviewWorld();
    await expectRejected(world, await submit(world.at(29), world, 1, itemOne(world)), {
      kind: "ReviewNotDue",
      reason: "lapsed",
    });
  });

  it("the baseline cannot be submitted after day 7", async () => {
    const world = await givenReviewWorld();
    await expectRejected(world, await submit(world.at(8), world, 0, fullAnswers(world)), {
      kind: "ReviewNotDue",
      reason: "lapsed",
    });
  });

  it("the closing review is not due before the season's last day has passed", async () => {
    const world = await givenReviewWorld();
    await expectRejected(world, await submit(world.at(56), world, 4, fullAnswers(world)), {
      kind: "ReviewNotDue",
      reason: "notYet",
    });
  });

  it("a period that does not exist is not found, whatever the number", async () => {
    const world = await givenReviewWorld();
    for (const periodIndex of [5, -1, 1.5, Number.NaN]) {
      await expectRejected(world, await submit(world.at(15), world, periodIndex, itemOne(world)), {
        kind: "ReviewPeriodNotFound",
      });
    }
  });

  it("REQ-R9: a member with no commitment has no review to submit", async () => {
    const world = await givenReviewWorld({ andreaWithoutCommitments: true });
    const result = await submit(world.at(15), world, 1, []);
    expect(result).toEqual({ ok: false, error: { kind: "ReviewPeriodNotFound" } });
  });

  it("SC-83: a second submission is a conflict and the first stays intact", async () => {
    const world = await givenReviewWorld();
    await submit(world.at(16), world, 1, itemOne(world, 5, 5), { helped: "primero", hard: null });
    const again = await submit(world.at(17), world, 1, itemOne(world, 1, 1), {
      helped: "segundo",
      hard: null,
    });
    expect(again).toEqual({ ok: false, error: { kind: "ReviewAlreadySubmitted" } });
    const rows = await stored(world);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reflection.helped).toBe("primero");
    expect(rows[0]?.responses[0]?.items[0]).toBe(5);
  });

  it("two simultaneous submits store ONE review and the loser is a ConcurrencyConflict", async () => {
    const world = await givenReviewWorld();
    const app = world.at(16);
    const settled = await Promise.allSettled([
      submit(app, world, 1, itemOne(world)),
      submit(app, world, 1, itemOne(world)),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const lost = settled.find((s) => s.status === "rejected");
    expect(lost?.status === "rejected" && lost.reason).toBeInstanceOf(ConcurrencyConflict);
    expect(await stored(world)).toHaveLength(1);
  });
});

describe("submitReview: who can submit (REQ-S3, REQ-S7, SC-85)", () => {
  it("an unknown season", async () => {
    const world = await givenReviewWorld();
    const result = await submitReview(world.at(15), world.andrea, {
      seasonId: seasonId("nope"),
      periodIndex: 1,
      reflection: NO_REFLECTION,
      automaticity: itemOne(world),
    });
    expect(result).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
  });

  it("someone outside the circle", async () => {
    const world = await givenReviewWorld();
    const stranger = { userId: userId("user-stranger") };
    const result = await submit(world.at(15), world, 1, itemOne(world), NO_REFLECTION, stranger);
    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("a season whose pact is still open", async () => {
    const world = await givenReviewWorld();
    await world.app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(SEASON);
      if (!season) throw new Error("no season");
      await repos.seasons.save(
        { ...season, status: "pactOpen", actualStart: null, pactClosedAt: null, version: 1 },
        0,
      );
      return { ok: true, value: undefined };
    });
    const result = await submit(world.at(15), world, 1, itemOne(world));
    expect(result).toEqual({ ok: false, error: { kind: "SeasonNotActive" } });
  });

  it("another member's commitment id", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(15), world, 1, [
      ...itemOne(world),
      { commitmentId: world.victorRun, items: one(4) },
    ]);
    await expectRejected(world, result, { kind: "CommitmentNotOwned" });
  });

  it("an unknown commitment id", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(15), world, 1, [
      { commitmentId: commitmentId("ghost"), items: one(4) },
    ]);
    await expectRejected(world, result, { kind: "CommitmentNotOwned" });
  });

  it("Victor submits his own review, never Andrea's", async () => {
    const world = await givenReviewWorld();
    const result = await submit(
      world.at(15),
      world,
      1,
      [{ commitmentId: world.victorRun, items: one(6) }],
      NO_REFLECTION,
      world.victor,
    );
    expect(result.ok).toBe(true);
    expect(await stored(world)).toEqual([]);
  });
});

describe("submitReview: the answers (REQ-A6, SC-25, SC-31)", () => {
  it.each([
    ["0", 0],
    ["8", 8],
    ["3.5", 3.5],
    ["NaN", Number.NaN],
  ])("item 1 of %s is out of the 1..7 integer scale", async (_name, bad) => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(15), world, 1, [
      { commitmentId: world.meditar, items: one(bad) },
      { commitmentId: world.leer, items: one(3) },
    ]);
    await expectRejected(world, result, {
      kind: "InvalidAutomaticity",
      commitmentId: world.meditar,
    });
  });

  it("an item-1 review that also sends item 2 is rejected as unexpected", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(15), world, 1, [
      { commitmentId: world.meditar, items: [4, 4, null, null] },
      { commitmentId: world.leer, items: one(3) },
    ]);
    await expectRejected(world, result, {
      kind: "InvalidAutomaticity",
      commitmentId: world.meditar,
    });
  });

  it("a missing item 1 is invalid, and so is an answer that is not four slots", async () => {
    const world = await givenReviewWorld();
    for (const items of [[null, null, null, null], [4, null, null], [], [4, null, null, null, 2]]) {
      const result = await submit(world.at(15), world, 1, [
        { commitmentId: world.meditar, items },
        { commitmentId: world.leer, items: one(3) },
      ]);
      await expectRejected(world, result, {
        kind: "InvalidAutomaticity",
        commitmentId: world.meditar,
      });
    }
  });

  it("the same commitment twice is invalid", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(15), world, 1, [...itemOne(world), ...itemOne(world)]);
    await expectRejected(world, result, {
      kind: "InvalidAutomaticity",
      commitmentId: world.meditar,
    });
  });

  it("a commitment left unanswered makes the review incomplete", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(15), world, 1, [
      { commitmentId: world.meditar, items: one(4) },
    ]);
    await expectRejected(world, result, {
      kind: "AutomaticityIncomplete",
      commitmentIds: [world.leer],
    });
  });

  it("owner decision: a FULL review needs all four items for every commitment", async () => {
    const world = await givenReviewWorld();
    const result = await submit(
      world.at(29),
      world,
      2,
      fullAnswers(world, [4, 4, 5, 5], [3, null, null, null]),
    );
    await expectRejected(world, result, {
      kind: "AutomaticityIncomplete",
      commitmentIds: [world.leer],
    });
    const baseline = await submit(world.at(3), world, 0, itemOne(world));
    await expectRejected(world, baseline, {
      kind: "AutomaticityIncomplete",
      commitmentIds: [world.meditar, world.leer],
    });
  });

  it("an invalid answer wins over an incomplete one", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(29), world, 2, [
      { commitmentId: world.meditar, items: [4, 9, 5, 5] },
    ]);
    await expectRejected(world, result, {
      kind: "InvalidAutomaticity",
      commitmentId: world.meditar,
    });
  });
});

describe("submitReview: the reflection (REQ-S8, R12)", () => {
  it("an over-long field is NoteTooLong for that field and nothing is stored", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(15), world, 1, itemOne(world), {
      helped: null,
      hard: "x".repeat(281),
    });
    await expectRejected(world, result, { kind: "NoteTooLong", field: "hard" });
  });

  it("the limit itself is accepted", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(15), world, 1, itemOne(world), {
      helped: "x".repeat(280),
      hard: null,
    });
    expect(result.ok).toBe(true);
  });

  it("S4: the baseline has no reflection, so an over-long one does not reject it", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(3), world, 0, fullAnswers(world), {
      helped: "x".repeat(281),
      hard: "a\u0000b",
    });
    expect(result.ok).toBe(true);
  });

  it("text that cannot be stored is InvalidNote for that field", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(15), world, 1, itemOne(world), {
      helped: "a\u0000b",
      hard: null,
    });
    await expectRejected(world, result, { kind: "InvalidNote", field: "helped" });
  });
});

describe("submitReview: the 35b result (REQ-A7..A9, S9)", () => {
  it("names only what improved against the baseline, with the next review date", async () => {
    const world = await givenReviewWorld();
    await submit(world.at(3), world, 0, fullAnswers(world, [4, 4, 5, 5], [3, 3, 3, 3]));
    const result = await submit(
      world.at(29),
      world,
      2,
      fullAnswers(world, [5, 5, 5, 5], [3, 3, 3, 3]),
    );
    expect(result.ok && result.value.improvements).toEqual([
      { commitmentId: world.meditar, from: "4,5", to: "5,0" },
    ]);
    // Period 2 is review 2 of 4: the next one (3) is due on day 43.
    expect(result.ok && result.value.nextReviewDate).toBe(dateOfDay(43));
  });

  it("a score that stayed equal or went down is not named (SC-50)", async () => {
    const world = await givenReviewWorld();
    await submit(world.at(3), world, 0, fullAnswers(world, [4, 4, 5, 5], [5, 5, 5, 5]));
    const result = await submit(
      world.at(29),
      world,
      2,
      fullAnswers(world, [4, 4, 5, 5], [3, 3, 3, 3]),
    );
    expect(result.ok && result.value.improvements).toEqual([]);
  });

  it("SC-43: without a baseline there is no comparison", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(16), world, 1, itemOne(world, 4, 4));
    expect(result.ok && result.value.improvements).toEqual([]);
    expect(result.ok && result.value.nextReviewDate).toBe(dateOfDay(29));
  });

  it("SC-53: without a baseline the reference is the earliest earlier review", async () => {
    const world = await givenReviewWorld();
    await submit(world.at(16), world, 1, itemOne(world, 3, 3));
    const result = await submit(
      world.at(30),
      world,
      2,
      fullAnswers(world, [4, 4, 4, 4], [3, 3, 3, 3]),
    );
    expect(result.ok && result.value.improvements).toEqual([
      { commitmentId: world.meditar, from: "3,0", to: "4,0" },
    ]);
  });

  it("W3: an item-1 review against a full baseline compares item 1 with item 1", async () => {
    const world = await givenReviewWorld();
    // Baseline mean is 2,5 but its item 1 is 4: an item-1 answer of 4 did not improve.
    await submit(world.at(3), world, 0, fullAnswers(world, [4, 2, 2, 2], [3, 3, 3, 3]));
    const same = await submit(world.at(16), world, 1, itemOne(world, 4, 3));
    expect(same.ok && same.value.improvements).toEqual([]);
  });

  it("W3: an item-1 review that really went up is named from item 1 to item 1", async () => {
    const world = await givenReviewWorld();
    await submit(world.at(3), world, 0, fullAnswers(world, [4, 2, 2, 2], [3, 3, 3, 3]));
    const result = await submit(world.at(16), world, 1, itemOne(world, 6, 3));
    expect(result.ok && result.value.improvements).toEqual([
      { commitmentId: world.meditar, from: "4,0", to: "6,0" },
    ]);
  });

  it("W3: a full review against an item-1 reference compares item 1 with item 1", async () => {
    const world = await givenReviewWorld();
    await submit(world.at(16), world, 1, itemOne(world, 4, 3));
    // Mean 5,5 would look like an improvement; item 1 stayed at 4.
    const result = await submit(
      world.at(30),
      world,
      2,
      fullAnswers(world, [4, 6, 6, 6], [3, 3, 3, 3]),
    );
    expect(result.ok && result.value.improvements).toEqual([]);
  });

  it("a skipped baseline is no reference either", async () => {
    const world = await givenReviewWorld();
    await world.app.reviews.save(
      {
        id: "skip" as never,
        seasonId: SEASON,
        memberId: ANDREA,
        periodIndex: 0,
        kind: "baseline",
        status: "skipped",
        srbai: null,
        reflection: NO_REFLECTION,
        responses: [],
        recordedAt: world.app.clock.now(),
        version: 0,
      },
      null,
    );
    const result = await submit(world.at(16), world, 1, itemOne(world, 6, 6));
    expect(result.ok && result.value.improvements).toEqual([]);
  });

  it("SC-54: the closing review has no next review date", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(57), world, 4, fullAnswers(world));
    expect(result.ok && result.value.nextReviewDate).toBeNull();
  });

  it("the baseline's next review date is the first review's due-start", async () => {
    const world = await givenReviewWorld();
    const result = await submit(world.at(3), world, 0, fullAnswers(world));
    expect(result.ok && result.value.nextReviewDate).toBe(dateOfDay(15));
    expect(result.ok && result.value.improvements).toEqual([]);
  });
});
