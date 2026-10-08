import { describe, expect, it, vi } from "vitest";
import { memberId } from "../circle/circle.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
  SEASON_START,
} from "../testing/entry-fixtures.ts";
import { memberProgress } from "./member-progress.query.ts";

async function setup() {
  const app = createTestApp({ now: localInstant(SEASON_START), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, {
    unit: "done",
    schedule: {
      period: "perSession",
      frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
    },
  });
  await app.seasons.save(
    {
      ...given.season,
      commitments: given.season.commitments.map((c) => ({ ...c, privacy: "private" })),
    },
    0,
  );
  const ask = (actor = given.victor, target = memberId("member-andrea")) =>
    memberProgress(app, actor, { seasonId: given.season.id, memberId: target });
  return { app, given, ask };
}

describe("memberProgress authorization and enrichment", () => {
  it("does not fetch any peer-private habit metadata", async () => {
    const { app, ask } = await setup();
    const habits = vi.spyOn(app.habits, "getMany");
    const view = await ask();
    expect(view).toMatchObject({
      ok: true,
      value: {
        state: "active",
        scope: "others",
        viewerId: "member-victor",
        member: { memberId: "member-andrea", displayName: "Andrea" },
        points: 0,
        consistency: null,
        idealCompletion: null,
        commitments: [
          { kind: "hidden", commitmentId: "commitment-andrea", weightPercent: 100, points: 0 },
        ],
      },
    });
    expect(habits).not.toHaveBeenCalled();
  });

  it("enriches the owner's private commitment and captures the clock/read only once", async () => {
    const { app, given, ask } = await setup();
    const clock = vi.spyOn(app.clock, "now");
    const read = vi.spyOn(app.uow, "read");
    const view = await ask(given.andrea);
    expect(view).toMatchObject({
      ok: true,
      value: {
        scope: "own",
        commitments: [
          {
            kind: "detail",
            habit: { name: "Meditar", icon: null },
            privacy: "private",
            opportunities: { kept: 0, counted: 0 },
            pause: "none",
            measure: { unit: "done" },
          },
        ],
      },
    });
    expect(clock).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each(["outsider", "member-victor"])("denies actor %s before metadata fetch", async (user) => {
    const { app, ask } = await setup();
    const habits = vi.spyOn(app.habits, "getMany");
    expect(await ask({ userId: userId(user) })).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
    expect(habits).not.toHaveBeenCalled();
  });

  it("denies an unknown target before metadata fetch", async () => {
    const { app, given, ask } = await setup();
    const habits = vi.spyOn(app.habits, "getMany");
    expect(await ask(given.victor, memberId("ghost"))).toEqual({
      ok: false,
      error: { kind: "MemberNotFound" },
    });
    expect(habits).not.toHaveBeenCalled();
  });
});
