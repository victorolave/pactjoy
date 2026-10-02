import { fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { buildCommitment, commitmentId, type Measure } from "../commitment/commitment.ts";
import { habitId, seasonId, userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { circleFixture, memberFixture } from "../testing/builders.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
import { localDate } from "../time/local-date.ts";
import { seasonView } from "./season-view.query.ts";

const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");
const SECRET = commitmentId("c-secret");
const MINUTES: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: { period: "weeklyTotal" },
};

/** GIVEN Andrea holds a private commitment; Victor holds his visible one. */
async function setup() {
  const app = createTestApp({
    now: localInstant(localDate("2026-10-01")),
    timeZone: fixtureTimeZone,
  });
  const given = await givenActiveSeason(app, MINUTES);
  const victor = given.season.commitments.filter((c) => c.memberId !== ANDREA);
  await app.uow.transaction(async (repos) => {
    await repos.seasons.save(
      {
        ...given.season,
        commitments: [
          buildCommitment({
            id: SECRET,
            memberId: ANDREA,
            habitId: habitId("habit-secret"),
            weightPercent: 100,
            privacy: "private",
            measure: MINUTES,
          }),
          ...victor,
        ],
      },
      given.season.version,
    );
    return { ok: true, value: undefined };
  });
  const ask = (actor: typeof given.andrea, id = given.season.id) =>
    seasonView(app, actor, { seasonId: id });
  return { app, given, ask };
}

describe("seasonView: the season with the member who is asking", () => {
  it("SV-S1: returns the season and the viewer's own member id, resolved in the read", async () => {
    const { given, ask } = await setup();

    const result = await ask(given.andrea);

    expect(result).toMatchObject({
      ok: true,
      value: { viewerId: ANDREA, season: { id: given.season.id } },
    });
    if (!result.ok) throw new Error("expected a season");
    expect(result.value.season.commitments.map((c) => c.id)).toContain(SECRET);
  });

  it("SV-S2: another member gets the same season with their own viewer id", async () => {
    const { given, ask } = await setup();

    const result = await ask(given.victor);

    expect(result).toMatchObject({
      ok: true,
      value: { viewerId: VICTOR, season: { id: given.season.id } },
    });
  });

  it("SV-S3: a user outside the circle is NotAMember", async () => {
    const { ask } = await setup();

    expect(await ask({ userId: userId("user-stranger") })).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
  });

  it("SV-S4: an unknown season is SeasonNotFound", async () => {
    const { given, ask } = await setup();

    expect(await ask(given.andrea, seasonId("nope"))).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
  });

  it("a member who left the circle but held a commitment keeps read-only access", async () => {
    const { app, given, ask } = await setup();
    const left = circleFixture({
      id: given.circle.id,
      members: [
        memberFixture({ id: ANDREA, userId: given.andrea.userId, status: "left" }),
        memberFixture({ id: VICTOR, userId: given.victor.userId }),
      ],
    });
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(left, given.circle.version);
      return { ok: true, value: undefined };
    });

    expect(await ask(given.andrea)).toMatchObject({ ok: true, value: { viewerId: ANDREA } });
  });

  it("a member who left and never held a commitment is NotAMember", async () => {
    const { app, given, ask } = await setup();
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
    // Victor's commitment was removed from the season: he is no participant.
    await app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(given.season.id);
      if (!season) throw new Error("fixture setup failed");
      await repos.seasons.save(
        { ...season, commitments: season.commitments.filter((c) => c.memberId !== VICTOR) },
        season.version,
      );
      return { ok: true, value: undefined };
    });

    expect(await ask(given.victor)).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });
});
