import { describe, expect, it, vi } from "vitest";
import { memberId } from "../circle/circle.ts";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import { habitId, seasonId, userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { habitFixture, memberFixture } from "../testing/builders.ts";
import {
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
  SEASON_START,
} from "../testing/entry-fixtures.ts";
import { seasonProgress } from "./season-progress.query.ts";

const DAILY = {
  unit: "done",
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
} as const;

async function setup() {
  const app = createTestApp({ now: localInstant(SEASON_START), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, DAILY);
  const ask = (actor = given.andrea, targetSeasonId = given.season.id) =>
    seasonProgress(app, actor, { seasonId: targetSeasonId });
  return { app, given, ask };
}

describe("seasonProgress query (A2)", () => {
  it("returns full SeasonProgressView for an active season in one uow.read", async () => {
    const { app, given, ask } = await setup();
    const readSpy = vi.spyOn(app.uow, "read");

    const result = await ask();

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.state).toBe("active");
    if (result.value.state !== "active") return;

    // Check core properties
    expect(result.value.viewerId).toBe("member-andrea");
    expect(result.value.circle).toMatchObject({ name: "Test Circle" });
    expect(result.value.season).toMatchObject({
      lengthWeeks: given.season.lengthWeeks,
      actualStart: SEASON_START,
    });
    expect(result.value.calendar).toMatchObject({
      today: SEASON_START,
      weekIndex: 0,
      dayOfWeek: 1,
    });
    expect(result.value.standings).toMatchObject({
      memberCount: 2,
    });
    expect(result.value.own).toMatchObject({
      points: 0,
      consistency: null,
      idealCompletion: null,
    });

    // Check weeks array
    expect(result.value.weeks).toHaveLength(given.season.lengthWeeks);
    const [w0] = result.value.weeks;
    expect(w0).toBeDefined();
    expect(w0).toMatchObject({
      weekIndex: 0,
      timing: "current",
      facts: { counted: false, editable: true, final: false },
    });
    expect(w0?.members).toHaveLength(2);
  });

  it("handles solo circle (1 member: standings.memberCount 1, weeks[].members length 1)", async () => {
    const { app, given, ask } = await setup();
    const [firstMember] = given.circle.members;
    const [firstCommitment] = given.season.commitments;
    if (!firstMember || !firstCommitment) throw new Error("setup failed");

    await app.circles.save({ ...given.circle, members: [firstMember] }, given.circle.version);
    await app.seasons.save(
      { ...given.season, commitments: [firstCommitment] },
      given.season.version,
    );

    const result = await ask();
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.state !== "active") return;
    expect(result.value.standings.memberCount).toBe(1);
    expect(result.value.standings.rows).toHaveLength(1);
    expect(result.value.weeks[0]?.members).toHaveLength(1);
    expect(result.value.weeks[0]?.members[0]?.memberId).toBe(firstMember.id);
  });

  it("handles full circle (6 members: all 6 present, correct order, no leavers)", async () => {
    const { app, given, ask } = await setup();
    const activeMembers = Array.from({ length: 6 }, (_, i) =>
      memberFixture({
        id: memberId(`member-${i + 1}`),
        userId: userId(`user-${i + 1}`),
        displayName: `Miembro ${String.fromCharCode(65 + i)}`,
      }),
    );
    const leaver = memberFixture({
      id: memberId("member-leaver"),
      userId: userId("user-leaver"),
      displayName: "Leaver",
      status: "left",
    });
    const commitments = activeMembers.map((m) =>
      buildCommitment({
        id: commitmentId(`commitment-${m.id}`),
        memberId: m.id,
        habitId: habitId(`habit-${m.id}`),
        weightPercent: 100,
        privacy: "visible",
        measure: {
          unit: "done",
          schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
        },
      }),
    );
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(
        { ...given.circle, members: [...activeMembers, leaver] },
        given.circle.version,
      );
      await repos.seasons.save({ ...given.season, commitments }, given.season.version);
      for (const m of activeMembers) {
        await repos.habits.save(
          habitFixture({ id: habitId(`habit-${m.id}`), ownerId: m.userId, name: "Habit" }),
          null,
        );
      }
      return { ok: true, value: undefined };
    });

    const [firstActive] = activeMembers;
    if (!firstActive) throw new Error("setup failed");
    const result = await ask({ userId: firstActive.userId });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.state !== "active") return;
    expect(result.value.standings.memberCount).toBe(6);
    expect(result.value.standings.rows).toHaveLength(6);
    expect(result.value.standings.rows.some((r) => r.memberId === leaver.id)).toBe(false);
    expect(result.value.weeks[0]?.members).toHaveLength(6);
    expect(result.value.weeks[0]?.members.map((m) => m.memberId)).toEqual(
      result.value.standings.rows.map((r) => r.memberId),
    );
  });

  it("returns notStarted when season pact is open or start is null", async () => {
    const { app, given, ask } = await setup();
    await app.seasons.save({ ...given.season, status: "pactOpen" }, given.season.version);

    const result = await ask();
    expect(result).toEqual({
      ok: true,
      value: { state: "notStarted", seasonId: given.season.id },
    });
  });

  it("returns SeasonNotFound error when season does not exist", async () => {
    const { ask } = await setup();
    const result = await ask(undefined, seasonId("00000000-0000-0000-0000-000000000000"));
    expect(result).toEqual({
      ok: false,
      error: { kind: "SeasonNotFound" },
    });
  });

  it("returns NotAMember error when actor is not part of the circle", async () => {
    const { ask } = await setup();
    const outsider = { userId: userId("user-outsider") };
    const result = await ask(outsider);
    expect(result).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
  });
});
