import { fromInt, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import type { SeasonStatus } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import { seasonId, userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { circleFixture, memberFixture } from "../testing/builders.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
import { localDate } from "../time/local-date.ts";
import { standings } from "./standings.query.ts";

const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");
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

async function setup(status: SeasonStatus = "active", clockDate = localDate("2026-10-01")) {
  const app = createTestApp({ now: localInstant(clockDate), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, DAILY_REACH, status);
  const ask = (actor: Actor) => standings(app, actor, { seasonId: given.season.id });
  const andreaLogs = async () => {
    const result = await recordEntry(app, given.andrea, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      value: { kind: "quantity", value: "30" },
      clientRequestId: "r1",
    });
    expect(result.ok).toBe(true);
  };
  const victorLeaves = async () => {
    const left = circleFixture({
      id: given.circle.id,
      members: [
        memberFixture({ id: ANDREA, userId: given.andrea.userId }),
        memberFixture({ id: VICTOR, userId: given.victor.userId, status: "left" }),
      ],
    });
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(left, given.circle.version);
      return { ok: true, value: undefined };
    });
  };
  return { app, given, ask, andreaLogs, victorLeaves };
}

describe("standings: ranking by points, recomputed on every call", () => {
  it("ranks members by points and shows the rounded points of each", async () => {
    const { given, ask, andreaLogs } = await setup();
    await andreaLogs();

    expect(await ask(given.victor)).toEqual({
      ok: true,
      value: {
        kind: "ranked",
        eligibleParticipantCount: 2,
        rows: [
          { memberId: ANDREA, displayName: "Andrea", rank: 1, points: 36 },
          { memberId: VICTOR, displayName: "Victor", rank: 2, points: 0 },
        ],
      },
    });
  });

  it("SQ-10: every row carries the member's displayName, never a userId", async () => {
    const { given, ask } = await setup();

    const result = await ask(given.andrea);

    expect(result).toMatchObject({
      ok: true,
      value: { rows: [{ displayName: "Andrea" }, { displayName: "Victor" }] },
    });
    expect(JSON.stringify(result)).not.toContain("user-");
  });

  it("gives tied members the same rank", async () => {
    const { given, ask } = await setup();

    expect(await ask(given.andrea)).toMatchObject({
      ok: true,
      value: {
        rows: [
          { memberId: ANDREA, rank: 1 },
          { memberId: VICTOR, rank: 1 },
        ],
      },
    });
  });

  it("reflects a fresh entry immediately, with no invalidation step", async () => {
    const { given, ask, andreaLogs } = await setup();
    const before = await ask(given.andrea);

    await andreaLogs();
    const after = await ask(given.andrea);

    expect(before).not.toEqual(after);
    expect(after).toMatchObject({ value: { rows: [{ memberId: ANDREA, points: 36 }, {}] } });
  });

  it("applies pauses read through the port", async () => {
    const { app, given, ask, andreaLogs } = await setup();
    await andreaLogs();
    app.pauses.add(given.season.id, {
      memberId: ANDREA,
      commitmentId: given.andreaCommitment,
      requestedOn: seasonDay(0),
      startDay: seasonDay(1),
      end: { kind: "fixed", lastDay: seasonDay(14) },
      decision: { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
    });

    // 28 days minus 14 paused = 14 opportunities: 1000 / 14 = 71.43.
    expect(await ask(given.andrea)).toMatchObject({ value: { rows: [{ points: 71 }, {}] } });
  });
});

describe("standings: eligibility", () => {
  // Engine rule Q3 (kept by decision, 2026-09-30): a member who left is excluded from the
  // rows and from the rank count.
  it("CM-14, SQ-4/SQ-5: a leaver is not ranked, the full rows and the count still come back (T2), and the leaver can still read", async () => {
    const { given, ask, victorLeaves } = await setup();
    await victorLeaves();
    const onlyAndrea = {
      ok: true,
      value: { kind: "ranked", eligibleParticipantCount: 1, rows: [{ memberId: ANDREA, rank: 1 }] },
    };

    expect(await ask(given.andrea)).toMatchObject(onlyAndrea);
    expect(await ask(given.victor)).toMatchObject(onlyAndrea);
  });

  it("only ranks members who hold a commitment in the season", async () => {
    const { app, given, ask } = await setup();
    const bystander = memberFixture({
      id: memberId("member-bystander"),
      userId: userId("user-by"),
    });
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(
        { ...given.circle, members: [...given.circle.members, bystander] },
        given.circle.version,
      );
      return { ok: true, value: undefined };
    });

    expect(await ask(given.andrea)).toMatchObject({ value: { eligibleParticipantCount: 2 } });
  });
});

describe("standings: when and for whom", () => {
  it("reports notStarted while the pact is still open", async () => {
    const { given, ask } = await setup("pactOpen");

    expect(await ask(given.andrea)).toEqual({ ok: true, value: { kind: "notStarted" } });
  });

  it("rejects an unknown season", async () => {
    const { app, given } = await setup();

    expect(await standings(app, given.andrea, { seasonId: seasonId("nope") })).toEqual({
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

  it("rejects a member who left without ever holding a commitment", async () => {
    const { app, given, ask } = await setup();
    const bystander = memberFixture({
      id: memberId("member-bystander"),
      userId: userId("user-bystander"),
      status: "left",
    });
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(
        { ...given.circle, members: [...given.circle.members, bystander] },
        given.circle.version,
      );
      return { ok: true, value: undefined };
    });

    expect(await ask({ userId: userId("user-bystander") })).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
  });
});
