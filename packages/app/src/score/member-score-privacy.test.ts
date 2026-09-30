import { fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { buildCommitment, commitmentId, type Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { habitId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
import { localDate } from "../time/local-date.ts";
import { memberScore } from "./member-score.query.ts";

const ANDREA = memberId("member-andrea");
const DAILY_MINUTES: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};
const THREE_A_WEEK: Measure = {
  unit: "done",
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
};

/**
 * GIVEN Andrea has two commitments (60% minutes, 40% done) whose privacy is
 * set per commitment, and has logged the minutes once. Victor is the other member.
 */
async function setup(minutesPrivacy: "visible" | "private", donePrivacy: "visible" | "private") {
  const app = createTestApp({
    now: localInstant(localDate("2026-10-01")),
    timeZone: fixtureTimeZone,
  });
  const given = await givenActiveSeason(app, DAILY_MINUTES);
  const minutes = commitmentId("c-first");
  const done = commitmentId("c-second");
  const commitment = (
    id: typeof minutes,
    weightPercent: number,
    measure: Measure,
    privacy: "visible" | "private",
  ) =>
    buildCommitment({
      id,
      memberId: ANDREA,
      habitId: habitId(`habit-${id}`),
      weightPercent,
      privacy,
      measure,
    });
  const victor = given.season.commitments.filter((c) => c.memberId !== ANDREA);
  await app.uow.transaction(async (repos) => {
    await repos.seasons.save(
      {
        ...given.season,
        commitments: [
          commitment(minutes, 60, DAILY_MINUTES, minutesPrivacy),
          commitment(done, 40, THREE_A_WEEK, donePrivacy),
          ...victor,
        ],
      },
      given.season.version,
    );
    return { ok: true, value: undefined };
  });
  const logged = await recordEntry(app, given.andrea, {
    seasonId: given.season.id,
    commitmentId: minutes,
    value: { kind: "quantity", value: "30" },
    clientRequestId: "r1",
  });
  expect(logged.ok).toBe(true);
  const ask = async (viewer: typeof given.andrea) => {
    const result = await memberScore(app, viewer, { seasonId: given.season.id, memberId: ANDREA });
    if (!result.ok || result.value.kind !== "scored") throw new Error("expected a score");
    return result.value.commitments;
  };
  return { given, ask, minutes, done };
}

describe("memberScore: commitments and the privacy projection", () => {
  it("SQ-1: a visible commitment shows full detail to every circle member", async () => {
    const { given, ask, minutes } = await setup("visible", "visible");

    const [first] = await ask(given.victor);

    // 60% of 1000 points, 1 of 28 opportunities at full progress: 600 / 28 = 21.43.
    expect(first).toEqual({
      kind: "detail",
      commitmentId: minutes,
      habitId: habitId(`habit-${minutes}`),
      weightPercent: 60,
      privacy: "visible",
      measure: DAILY_MINUTES,
      points: 21,
      consistency: 100,
      idealCompletion: 100,
      streak: expect.objectContaining({ unit: "day" }),
    });
  });

  it("SQ-2: a private commitment shows others only its existence, weight and points", async () => {
    const { given, ask, minutes } = await setup("private", "visible");

    const [first, second] = await ask(given.victor);

    expect(first).toStrictEqual({
      kind: "hidden",
      commitmentId: minutes,
      weightPercent: 60,
      points: 21,
    });
    expect(second?.kind).toBe("detail");
  });

  it("SQ-2: nothing about a private commitment leaks anywhere in what others receive", async () => {
    const { given, ask, minutes } = await setup("private", "private");

    const serialized = JSON.stringify(await ask(given.victor), (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );

    for (const secret of [`habit-${minutes}`, "minutes", "reach", "specificDays", "timesPerWeek"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("SQ-3: the owner sees full detail of their own private commitment", async () => {
    const { given, ask } = await setup("private", "private");

    const commitments = await ask(given.andrea);

    expect(commitments.map((c) => c.kind)).toEqual(["detail", "detail"]);
    expect(commitments[0]).toMatchObject({ privacy: "private", measure: DAILY_MINUTES });
  });

  it("keeps every commitment visible as at least existing, in order, privacy notwithstanding", async () => {
    const { given, ask, minutes, done } = await setup("private", "visible");

    const commitments = await ask(given.victor);

    expect(commitments.map((c) => c.commitmentId)).toEqual([minutes, done]);
  });
});
