import { commitmentId, habitId, instant, memberId, memberProgress, seasonId } from "@pactjoy/app";
import { habitFixture, memberFixture } from "@pactjoy/app/testing";
import { describe, expect, it, vi } from "vitest";
import { presentMemberProgress } from "../src/presenters/progress-member.ts";
import { givenTwoMemberSeason } from "./entries-fixture.ts";
import { ANDREA, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

const DAILY = {
  unit: "done",
  frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
};
const PUBLIC_ID = "cccccccc-0000-4000-8000-000000000000";

async function setup(solo = false) {
  const ctx = await givenTwoMemberSeason(DAILY);
  const season = await ctx.app.seasons.get(seasonId(ctx.seasonId));
  if (!season) throw new Error("missing season");
  const circle = await ctx.app.circles.get(season.circleId);
  const target = circle?.members.find((m) => m.userId === VICTOR);
  const own = season.commitments.find((c) => c.memberId === target?.id);
  if (!circle || !target || !own) throw new Error("missing participant");
  if (solo) await ctx.app.circles.save({ ...circle, members: [target] }, circle.version);
  const secret = await ctx.app.habits.get(own.habitId);
  if (!secret) throw new Error("missing private habit");
  await ctx.app.habits.save({ ...secret, name: "SECRET_HABIT", why: "SECRET_WHY" }, 0);
  await ctx.app.habits.save(
    habitFixture({ id: habitId(PUBLIC_ID), ownerId: VICTOR, name: "Caminar", icon: "footprints" }),
    null,
  );
  const visible = {
    ...own,
    id: commitmentId(PUBLIC_ID),
    habitId: habitId(PUBLIC_ID),
    weightPercent: 40,
  };
  await ctx.app.seasons.save(
    {
      ...season,
      commitments: [
        ...season.commitments.filter((c) => !solo && c.memberId !== target.id),
        { ...own, weightPercent: 60, privacy: "private" },
        visible,
      ],
    },
    season.version,
  );
  for (const [id, value] of [
    [own.id, { kind: "done" }],
    [visible.id, { kind: "missed" }],
  ] as const) {
    expect(
      (
        await ctx.call("POST", ctx.path, "victor", {
          commitmentId: id,
          value,
          note: "SECRET_NOTE",
          clientRequestId: id,
        })
      ).status,
    ).toBe(201);
  }
  const path = `/seasons/${season.id}/members/${target.id}/progress`;
  return { ...ctx, season, circle, target, own, path };
}

describe("GET member progress (23d)", () => {
  it("includes ALL commitments in peer aggregates, but fetches only visible habits", async () => {
    const ctx = await setup();
    const habits = vi.spyOn(ctx.app.habits, "getMany");
    const res = await ctx.call("GET", ctx.path, "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      state: "active",
      scope: "others",
      member: { memberId: ctx.target.id, displayName: ctx.target.displayName },
      points: 21,
      consistency: 50,
      idealCompletion: 60,
    });
    expect(res.json.data.commitments).toHaveLength(2);
    expect(res.json.data.commitments[0]).toEqual({
      kind: "hidden",
      commitmentId: ctx.own.id,
      weightPercent: 60,
      points: 21,
    });
    expect(res.json.data.commitments[1]).toMatchObject({
      habit: { name: "Caminar", icon: "footprints" },
      opportunities: { kept: 0, counted: 1 },
    });
    expect(habits).toHaveBeenCalledExactlyOnceWith([habitId(PUBLIC_ID)]);
    for (const secret of [
      ctx.own.habitId,
      "SECRET_",
      "userId",
      "habitId",
      "clientRequestId",
      "history",
    ]) {
      expect(JSON.stringify(res.json)).not.toContain(secret);
    }
    const legacy = await ctx.call("GET", ctx.path.replace("/progress", "/score"), "andrea");
    expect(legacy.json.data).toMatchObject({ points: 21, consistency: 50, idealCompletion: 60 });
    const view = await memberProgress(
      ctx.app,
      { userId: ANDREA },
      { seasonId: ctx.season.id, memberId: ctx.target.id },
    );
    if (!view.ok || view.value.state === "notStarted" || view.value.scope !== "others")
      throw new Error("expected peer progress");
    const poisoned = {
      ...view.value,
      commitments: view.value.commitments.map((row) => ({
        ...row,
        habitId: "SECRET_ID",
        note: "SECRET_NOTE",
      })),
    };
    expect(presentMemberProgress(poisoned)).toEqual(res.json.data);
  });

  it.each([false, true])(
    "shows the owner's private habit without audit fields (solo=%s)",
    async (solo) => {
      const ctx = await setup(solo);
      const res = await ctx.call("GET", ctx.path, "victor");
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({
        scope: "own",
        commitments: [
          { kind: "detail", habit: { name: "SECRET_HABIT" }, privacy: "private" },
          { kind: "detail" },
        ],
      });
      expect(JSON.stringify(res.json)).not.toContain("SECRET_NOTE");
      expect(JSON.stringify(res.json)).not.toContain("SECRET_WHY");
    },
  );

  it("validates both ids, auth and entity errors without leaking metadata", async () => {
    const ctx = await setup();
    const habits = vi.spyOn(ctx.app.habits, "getMany");
    for (const [path, token, status, code] of [
      [ctx.path, null, 401, "Unauthorized"],
      [ctx.path, "bogus", 401, "Unauthorized"],
      [ctx.path.replace(ctx.seasonId, "nope"), "andrea", 422, "InvalidRequest"],
      [ctx.path.replace(ctx.target.id, "NOPE"), "andrea", 422, "InvalidRequest"],
      [ctx.path.replace(ctx.seasonId, UNKNOWN_CIRCLE), "andrea", 404, "SeasonNotFound"],
      [ctx.path.replace(ctx.target.id, VICTOR), "andrea", 404, "MemberNotFound"],
    ] as const) {
      const res = await ctx.call("GET", path, token);
      expect([res.status, res.json.error?.code]).toEqual([status, code]);
    }
    expect(habits).not.toHaveBeenCalled();
  });

  it.each(["outsider", "former-nonparticipant"])("rejects %s before habit fetch", async (kind) => {
    const ctx = await setup();
    await ctx.app.circles.save(
      {
        ...ctx.circle,
        members: [
          ctx.target,
          ...(kind === "outsider"
            ? []
            : [memberFixture({ id: memberId(UNKNOWN_CIRCLE), userId: ANDREA, status: "left" })]),
        ],
      },
      ctx.circle.version,
    );
    const habits = vi.spyOn(ctx.app.habits, "getMany");
    const res = await ctx.call("GET", ctx.path, "andrea");
    expect([res.status, res.json.error.code]).toEqual([403, "NotAMember"]);
    expect(habits).not.toHaveBeenCalled();
  });

  it("preserves reads by and of former participants after archiving", async () => {
    const ctx = await setup();
    await ctx.app.circles.save(
      {
        ...ctx.circle,
        archivedAt: ctx.app.clock.now(),
        members: ctx.circle.members.map((m) => ({ ...m, status: "left" })),
      },
      ctx.circle.version,
    );
    expect((await ctx.call("GET", ctx.path, "andrea")).json.data.scope).toBe("others");
    expect((await ctx.call("GET", ctx.path, "victor")).json.data.scope).toBe("own");
  });

  it.each(["pactOpen", "future"])("returns notStarted for %s without metadata", async (state) => {
    const ctx = await setup();
    await ctx.app.seasons.save(
      {
        ...ctx.season,
        actualStart: state === "pactOpen" ? null : ctx.season.actualStart,
        status: state === "pactOpen" ? "pactOpen" : "active",
      },
      ctx.season.version,
    );
    if (state === "future") ctx.setNow(instant(ctx.app.clock.now() - 86_400_000));
    const habits = vi.spyOn(ctx.app.habits, "getMany");
    const res = await ctx.call("GET", ctx.path, "andrea");
    expect([res.status, res.json.data]).toEqual([
      200,
      { state: "notStarted", seasonId: ctx.seasonId },
    ]);
    expect(habits).not.toHaveBeenCalled();
  });
});
