import { describe, expect, it } from "vitest";
import { circleId, seasonId, userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { circleFixture, memberFixture, seasonFixture } from "../testing/builders.ts";
import { joinCircleInput } from "../testing/circle-inputs.ts";
import { fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { epochDay, localDate, localDateOfEpochDay } from "../time/local-date.ts";
import { type Member, memberId } from "./circle.ts";
import { inviteCode } from "./invite-code.ts";
import { joinCircle } from "./join-circle.ts";
import { previewInvite } from "./preview-invite.ts";

const DAY = (n: number) => localDateOfEpochDay(epochDay(localDate("2026-10-01")) + n);
const CODE = "7K4Q2M";
const ANDREA = memberFixture({
  id: memberId("member-andrea"),
  userId: userId("user-andrea"),
  displayName: "Andrea",
});
const JOINER = { userId: userId("user-joiner") };

const invite = (overrides: { expiresAt?: number | undefined; createdBy?: Member["id"] } = {}) => ({
  code: inviteCode(CODE),
  createdAt: localInstant(DAY(-1)),
  expiresAt: localInstant(DAY(overrides.expiresAt ?? 6)),
  createdBy: overrides.createdBy ?? ANDREA.id,
});

interface Fixture {
  readonly members?: readonly Member[];
  readonly archived?: boolean;
  readonly expiresAt?: number;
  readonly season?: "pactOpen" | "active" | "closed";
  readonly other?: boolean;
  readonly code?: string;
}

async function given(fixture: Fixture) {
  const app = createTestApp({ now: localInstant(DAY(0)), timeZone: fixtureTimeZone });
  const circle = circleFixture({
    id: circleId("circle-1"),
    name: "Los Pactos",
    members: fixture.members ?? [ANDREA],
    invite: invite({ expiresAt: fixture.expiresAt }),
    archivedAt: fixture.archived ? localInstant(DAY(-1)) : null,
  });
  await app.uow.transaction(async (repos) => {
    await repos.circles.save(circle, null);
    if (fixture.season) {
      await repos.seasons.save(
        seasonFixture({ id: seasonId("s1"), circleId: circle.id, status: fixture.season }),
        null,
      );
    }
    if (fixture.other) {
      await repos.circles.save(
        circleFixture({
          id: circleId("circle-2"),
          members: [
            memberFixture({ id: memberId("member-j"), userId: JOINER.userId, displayName: "J" }),
          ],
        }),
        null,
      );
    }
    return { ok: true, value: undefined };
  });
  return { app, code: fixture.code ?? CODE };
}

const sixMembers = Array.from({ length: 6 }, (_, i) =>
  memberFixture({ id: memberId(`member-${i}`), userId: userId(`user-${i}`), displayName: `M${i}` }),
);

const TABLE: readonly [string, Fixture, string | "ok"][] = [
  ["IP-S1 valid", {}, "ok"],
  ["IP-S1 pact open still joinable", { season: "pactOpen" }, "ok"],
  ["IP-S6 unknown code", { code: "AAAAAA" }, "InviteNotFound"],
  ["malformed code is the same error", { code: "zz" }, "InviteNotFound"],
  ["archived circle", { archived: true }, "CircleArchived"],
  ["IP-S2 expired", { expiresAt: -1 }, "InviteExpired"],
  ["IP-S3 already in a circle", { other: true }, "AlreadyInActiveCircle"],
  ["IP-S5 active season", { season: "active" }, "SeasonNotJoinable"],
  ["IP-S4 full circle", { members: sixMembers }, "CircleFull"],
];

describe("previewInvite (IP-R1, IP-R2)", () => {
  it.each(TABLE)("%s: preview and join agree", async (_name, fixture, expected) => {
    const { app, code } = await given(fixture);
    const preview = await previewInvite(app, JOINER, { inviteCode: code });
    const joined = await joinCircle(app, JOINER, joinCircleInput(code));
    expect(preview.ok ? "ok" : preview.error.kind).toBe(expected);
    expect(joined.ok ? "ok" : joined.error.kind).toBe(expected);
  });

  it("returns name, count, expiry and the inviter's name; no member ids", async () => {
    const { app } = await given({ members: [ANDREA, sixMembers[0] as Member] });
    const preview = await previewInvite(app, JOINER, { inviteCode: ` ${CODE.toLowerCase()} ` });
    expect(preview).toEqual({
      ok: true,
      value: {
        circleName: "Los Pactos",
        invitedBy: "Andrea",
        activeMemberCount: 2,
        expiresAt: localInstant(DAY(6)),
      },
    });
  });

  it("invitedBy is null once the inviter left", async () => {
    const left = { ...ANDREA, status: "left" as const, leftAt: localInstant(DAY(-1)) };
    const { app } = await given({ members: [left, sixMembers[0] as Member] });
    const preview = await previewInvite(app, JOINER, { inviteCode: CODE });
    expect(preview).toMatchObject({ ok: true, value: { invitedBy: null, activeMemberCount: 1 } });
  });

  it("does not mutate state", async () => {
    const { app } = await given({});
    await previewInvite(app, JOINER, { inviteCode: CODE });
    const circle = await app.uow.read((repos) => repos.circles.findActiveByUser(ANDREA.userId));
    expect(circle?.members).toHaveLength(1);
    expect(circle?.version).toBe(0);
  });
});
