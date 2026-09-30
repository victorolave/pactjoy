import { fromInt, type MemberId, type PauseRequest, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import type { SeasonStatus } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import { seasonId, userId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { circleFixture, memberFixture } from "../testing/builders.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
import { localDate } from "../time/local-date.ts";
import { type MemberScoreInput, memberScore } from "./member-score.query.ts";

const DAY = (n: number) => localDate(`2026-10-${String(1 + n).padStart(2, "0")}`);
const DAILY_REACH: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};
const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");
const NOT_FOUND = { ok: false, error: { kind: "MemberNotFound" } };

/** A 4-week season whose day 0 is 2026-10-01; the clock reads `clockDate`. */
async function setup(status: SeasonStatus = "active", clockDate = DAY(0)) {
  const app = createTestApp({ now: localInstant(clockDate), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, DAILY_REACH, status);
  const ask = (actor: Actor, extra: Partial<MemberScoreInput> = {}) =>
    memberScore(app, actor, { seasonId: given.season.id, ...extra });
  return { app, given, ask };
}

async function record(
  app: TestApp,
  given: Awaited<ReturnType<typeof setup>>["given"],
  value = "30",
) {
  const result = await recordEntry(app, given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    value: { kind: "quantity", value },
    clientRequestId: `r-${value}`,
  });
  expect(result.ok).toBe(true);
}

const SCORED_ANDREA_ZERO = {
  kind: "scored",
  memberId: ANDREA,
  points: 0,
  consistency: null,
  idealCompletion: null,
};

function approvedPause(owner: MemberId, commitmentId: PauseRequest["commitmentId"]) {
  return {
    memberId: owner,
    commitmentId,
    requestedOn: seasonDay(0),
    startDay: seasonDay(1),
    end: { kind: "fixed", lastDay: seasonDay(14) },
    decision: { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
  } as const;
}

describe("memberScore: recomputed from entries on every call", () => {
  it("SQ-6: two reads with no change in between return identical numbers", async () => {
    const { app, given, ask } = await setup();
    await record(app, given);

    expect(await ask(given.andrea)).toEqual(await ask(given.andrea));
  });

  it("SQ-7: a fresh entry is reflected immediately, with no invalidation step", async () => {
    const { app, given, ask } = await setup();
    const before = await ask(given.andrea);

    await record(app, given);
    const after = await ask(given.andrea);

    expect(before).toMatchObject({ ok: true, value: SCORED_ANDREA_ZERO });
    // 1 of 28 opportunities at full progress: 1000 / 28 = 35.71, shown rounded half up.
    expect(after).toMatchObject({
      ok: true,
      value: { ...SCORED_ANDREA_ZERO, points: 36, consistency: 100, idealCompletion: 100 },
    });
  });
});

describe("memberScore: pauses through the read-only port (SQ-8)", () => {
  it("excludes the opportunities of an approved pause from the denominator", async () => {
    const { app, given, ask } = await setup();
    await record(app, given);
    app.pauses.add(given.season.id, approvedPause(ANDREA, given.andreaCommitment));

    // 28 days minus 14 paused = 14 active opportunities: 1000 / 14 = 71.43.
    expect(await ask(given.andrea)).toMatchObject({ ok: true, value: { points: 71 } });
  });

  it("ignores a pause that belongs to another member", async () => {
    const { app, given, ask } = await setup();
    await record(app, given);
    // Victor's pause record points at Andrea's commitment: only the owner filter keeps it out.
    app.pauses.add(given.season.id, approvedPause(VICTOR, given.andreaCommitment));

    expect(await ask(given.andrea)).toMatchObject({ ok: true, value: { points: 36 } });
  });
});

describe("memberScore: whose score, and when", () => {
  it("defaults to the viewer's own score and lets any member read another's", async () => {
    const { app, given, ask } = await setup();
    await record(app, given);

    expect(await ask(given.andrea)).toMatchObject({ value: { memberId: ANDREA, points: 36 } });
    expect(await ask(given.victor)).toMatchObject({ value: { memberId: VICTOR, points: 0 } });
    expect(await ask(given.victor, { memberId: ANDREA })).toMatchObject({
      value: { memberId: ANDREA, points: 36 },
    });
  });

  it("reports notStarted while the pact is still open", async () => {
    const { given, ask } = await setup("pactOpen");

    expect(await ask(given.andrea)).toEqual({ ok: true, value: { kind: "notStarted" } });
  });

  it("reports notStarted before the season's actual start", async () => {
    const { given, ask } = await setup("active", localDate("2026-09-30"));

    expect(await ask(given.andrea)).toEqual({ ok: true, value: { kind: "notStarted" } });
  });
});

describe("memberScore: who may ask, and about whom", () => {
  const BYSTANDER = memberId("member-bystander");
  const bystanderUser = userId("user-bystander");

  /** Victor (a participant) left; a bystander who never held a commitment is added, active or left. */
  async function circleAfter(bystanderStatus: "active" | "left") {
    const scenario = await setup();
    const { app, given } = scenario;
    const next = circleFixture({
      id: given.circle.id,
      members: [
        memberFixture({ id: ANDREA, userId: given.andrea.userId }),
        memberFixture({ id: VICTOR, userId: given.victor.userId, status: "left" }),
        memberFixture({ id: BYSTANDER, userId: bystanderUser, status: bystanderStatus }),
      ],
    });
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(next, given.circle.version);
      return { ok: true, value: undefined };
    });
    return scenario;
  }

  it("rejects an unknown season", async () => {
    const { app, given } = await setup();

    expect(await memberScore(app, given.andrea, { seasonId: seasonId("nope") })).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
  });

  it("rejects someone who is not in the circle", async () => {
    const { ask } = await setup();

    expect(await ask({ userId: userId("user-stranger") })).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
  });

  it("lets a participant who left the circle read the season's history", async () => {
    const { given, ask } = await circleAfter("active");

    expect(await ask(given.victor)).toMatchObject({ ok: true, value: { memberId: VICTOR } });
  });

  it("lets anyone read the score of a participant who left", async () => {
    const { given, ask } = await circleAfter("active");

    expect(await ask(given.andrea, { memberId: VICTOR })).toMatchObject({
      ok: true,
      value: { memberId: VICTOR },
    });
  });

  it("lets an active member who holds no commitment read too", async () => {
    const { ask } = await circleAfter("active");

    expect(await ask({ userId: bystanderUser }, { memberId: ANDREA })).toMatchObject({ ok: true });
  });

  it("rejects a member who left without ever holding a commitment", async () => {
    const { ask } = await circleAfter("left");

    expect(await ask({ userId: bystanderUser })).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
  });

  it("rejects a target who is in the circle but holds no commitment in the season", async () => {
    const { given, ask } = await circleAfter("active");

    expect(await ask(given.andrea, { memberId: BYSTANDER })).toEqual(NOT_FOUND);
  });

  it("rejects a target who was never in the circle", async () => {
    const { given, ask } = await setup();

    expect(await ask(given.andrea, { memberId: memberId("member-ghost") })).toEqual(NOT_FOUND);
  });
});
