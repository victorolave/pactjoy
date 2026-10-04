import { describe, expect, it } from "vitest";
import { circleId, seasonId, userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { circleFixture, memberFixture, seasonFixture } from "../testing/builders.ts";
import { fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { epochDay, localDate, localDateOfEpochDay } from "../time/local-date.ts";
import { memberId } from "./circle.ts";
import { inviteCode } from "./invite-code.ts";
import { myCircle } from "./my-circle.query.ts";

const DAY = (n: number) => localDateOfEpochDay(epochDay(localDate("2026-10-01")) + n);
const ANDREA = memberFixture({
  id: memberId("member-andrea"),
  userId: userId("user-andrea"),
  displayName: "Andrea",
});
const VICTOR = memberFixture({
  id: memberId("member-victor"),
  userId: userId("user-victor"),
  displayName: "Victor",
});
const LEFT = memberFixture({
  id: memberId("member-left"),
  userId: userId("user-left"),
  displayName: "Gone",
  status: "left",
  leftAt: localInstant(DAY(-1)),
});
const INVITE = {
  code: inviteCode("7K4Q2M"),
  createdAt: localInstant(DAY(-1)),
  expiresAt: localInstant(DAY(7)),
  createdBy: ANDREA.id,
};

async function setup(
  clockDate = DAY(0),
  circleOptions: Partial<Parameters<typeof circleFixture>[0]> = {},
  season?: Parameters<typeof seasonFixture>[0] extends infer O ? Partial<O> : never,
) {
  const app = createTestApp({ now: localInstant(clockDate), timeZone: fixtureTimeZone });
  const circle = circleFixture({
    id: circleId("circle-1"),
    name: "Los Pactos",
    members: [ANDREA, VICTOR, LEFT],
    invite: INVITE,
    ...circleOptions,
  });
  await app.uow.transaction(async (repos) => {
    await repos.circles.save(circle, null);
    if (season) {
      await repos.seasons.save(
        seasonFixture({ id: seasonId("season-1"), circleId: circle.id, ...season }),
        null,
      );
    }
    return { ok: true, value: undefined };
  });
  return { app, circle };
}

describe("myCircle (CR-R1..R3)", () => {
  it("CR-S2: a user with no active circle gets nulls", async () => {
    const app = createTestApp();
    expect(await myCircle(app, { userId: userId("user-nobody") })).toEqual({
      circle: null,
      season: null,
    });
  });

  it("a circle without season has season null; carries the viewer, invite and active members only", async () => {
    const { app, circle } = await setup();
    const view = await myCircle(app, ANDREA);
    expect(view.season).toBeNull();
    expect(view.circle).toEqual({
      id: circle.id,
      name: "Los Pactos",
      members: [
        { id: ANDREA.id, displayName: "Andrea", joinedAt: ANDREA.joinedAt, isYou: true },
        { id: VICTOR.id, displayName: "Victor", joinedAt: VICTOR.joinedAt, isYou: false },
      ],
      invite: {
        code: INVITE.code,
        createdAt: INVITE.createdAt,
        expiresAt: INVITE.expiresAt,
      },
    });
  });

  it("never exposes user ids", async () => {
    const { app } = await setup();
    expect(JSON.stringify(await myCircle(app, ANDREA))).not.toContain("user-");
  });

  it("the invite is null when the circle has none; an expired invite is still returned", async () => {
    const none = await setup(DAY(0), { invite: null });
    expect((await myCircle(none.app, ANDREA)).circle?.invite).toBeNull();
    const expired = await setup(DAY(30));
    expect((await myCircle(expired.app, ANDREA)).circle?.invite?.expiresAt).toBe(INVITE.expiresAt);
  });

  it("CR-S3: a member who left sees no circle", async () => {
    const { app } = await setup();
    expect(await myCircle(app, LEFT)).toEqual({ circle: null, season: null });
  });

  it("CR-S1: an open pact reports pactOpen with the approval count and no week", async () => {
    const { app } = await setup(
      DAY(0),
      {},
      {
        status: "pactOpen",
        lengthWeeks: 6,
        approvals: [{ memberId: ANDREA.id, approvedAt: localInstant(DAY(-1)) }],
      },
    );
    expect((await myCircle(app, ANDREA)).season).toEqual({
      id: seasonId("season-1"),
      phase: "pactOpen",
      lengthWeeks: 6,
      week: null,
      approvalCount: 1,
    });
  });

  it("an active season starting in the future is notStarted", async () => {
    const { app } = await setup(DAY(0), {}, { status: "active", actualStart: DAY(2) });
    expect((await myCircle(app, ANDREA)).season).toMatchObject({ phase: "notStarted", week: null });
  });

  it("an active season reports its 1-based week", async () => {
    const { app } = await setup(DAY(9), {}, { status: "active", actualStart: DAY(0) });
    expect((await myCircle(app, ANDREA)).season).toMatchObject({ phase: "active", week: 2 });
  });

  it("an ended season stays on its last week", async () => {
    const { app } = await setup(
      DAY(100),
      {},
      { status: "active", actualStart: DAY(0), lengthWeeks: 4 },
    );
    expect((await myCircle(app, ANDREA)).season).toMatchObject({ phase: "ended", week: 4 });
  });

  it("a closed latest season is reported as no season", async () => {
    const { app } = await setup(DAY(0), {}, { status: "closed", actualStart: DAY(0) });
    expect((await myCircle(app, ANDREA)).season).toBeNull();
  });
});
