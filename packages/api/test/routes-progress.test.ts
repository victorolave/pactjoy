import { commitmentId, habitId, memberId, seasonId, userId } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { givenActiveSeason, givenTwoMemberSeason } from "./entries-fixture.ts";
import { UNKNOWN_CIRCLE } from "./harness.ts";

describe("GET /seasons/:seasonId/progress (A2)", () => {
  it("returns 200 with full SeasonProgressDto for circle member", async () => {
    const ctx = await givenTwoMemberSeason();
    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/progress`, "andrea");

    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      state: "active",
      circle: { name: "Crew" },
      season: { id: ctx.seasonId },
      calendar: { weekIndex: 0, dayOfWeek: 1 },
      standings: { memberCount: 2 },
      own: { points: 0 },
    });
    expect(res.json.data.viewerId).toBeDefined();
    expect(res.json.data.weeks).toHaveLength(4);
    expect(res.json.data.weeks[0]).toMatchObject({
      weekIndex: 0,
      timing: "current",
      facts: { counted: false, editable: true, final: false },
    });
  });

  it("returns 200 for solo circle (1 member: standings.memberCount 1, weeks[].members length 1)", async () => {
    const ctx = await givenActiveSeason();
    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/progress`, "andrea");

    expect(res.status).toBe(200);
    expect(res.json.data.standings.memberCount).toBe(1);
    expect(res.json.data.standings.rows).toHaveLength(1);
    expect(res.json.data.weeks[0].members).toHaveLength(1);
    expect(res.json.data.weeks[0].members[0].memberId).toBe(res.json.data.viewerId);
  });

  it("returns 200 for full circle (6 members: all 6 present, correct order, no leavers)", async () => {
    const ctx = await givenTwoMemberSeason();
    const season = await ctx.app.seasons.get(seasonId(ctx.seasonId));
    if (!season) throw new Error("missing season");
    const circle = await ctx.app.circles.get(season.circleId);
    if (!circle) throw new Error("missing circle");

    const [andreaMember, victorMember] = circle.members;
    if (!andreaMember || !victorMember) throw new Error("setup failed");

    const extraActive = [1, 2, 3, 4].map((n) => ({
      ...andreaMember,
      id: memberId(`aaaaaaaa-0000-4000-8000-00000000001${n}`),
      userId: userId(`aaaaaaaa-0000-4000-8000-00000000002${n}`),
      displayName: `Extra ${n}`,
      status: "active" as const,
    }));
    const leaver = {
      ...andreaMember,
      id: memberId("aaaaaaaa-0000-4000-8000-000000000099"),
      userId: userId("aaaaaaaa-0000-4000-8000-000000000099"),
      displayName: "Leaver",
      status: "left" as const,
    };

    const [baseCommitment] = season.commitments;
    if (!baseCommitment) throw new Error("setup failed");
    const extraCommitments = extraActive.map((m) => ({
      ...baseCommitment,
      id: commitmentId(`bbbbbbbb-0000-4000-8000-00000000001${m.displayName.slice(-1)}`),
      memberId: m.id,
      habitId: habitId(`cccccccc-0000-4000-8000-00000000001${m.displayName.slice(-1)}`),
    }));

    await ctx.app.circles.save(
      { ...circle, members: [andreaMember, victorMember, ...extraActive, leaver] },
      circle.version,
    );
    await ctx.app.seasons.save(
      { ...season, commitments: [...season.commitments, ...extraCommitments] },
      season.version,
    );

    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/progress`, "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data.standings.memberCount).toBe(6);
    expect(res.json.data.standings.rows).toHaveLength(6);
    const hasLeaver = res.json.data.standings.rows.some(
      (r: { memberId: string }) => r.memberId === leaver.id,
    );
    expect(hasLeaver).toBe(false);
    expect(res.json.data.weeks[0].members).toHaveLength(6);
    expect(res.json.data.weeks[0].members.map((m: { memberId: string }) => m.memberId)).toEqual(
      res.json.data.standings.rows.map((r: { memberId: string }) => r.memberId),
    );
  });

  it("returns notStarted when season is not started yet", async () => {
    const ctx = await givenTwoMemberSeason();
    const season = await ctx.app.seasons.get(seasonId(ctx.seasonId));
    if (!season) throw new Error("missing season");
    await ctx.app.seasons.save(
      { ...season, actualStart: null, status: "pactOpen" },
      season.version,
    );

    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/progress`, "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ state: "notStarted", seasonId: ctx.seasonId });
  });

  it("returns 401 when unauthenticated", async () => {
    const ctx = await givenTwoMemberSeason();
    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/progress`, null);
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not a member of the circle", async () => {
    const ctx = await givenActiveSeason();
    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/progress`, "victor");
    expect(res.status).toBe(403);
    expect(res.json.error?.code).toBe("NotAMember");
  });

  it("returns 404 when season does not exist", async () => {
    const ctx = await givenTwoMemberSeason();
    const res = await ctx.call("GET", `/seasons/${UNKNOWN_CIRCLE}/progress`, "andrea");
    expect(res.status).toBe(404);
  });

  it("returns 422 when seasonId is not a valid UUID", async () => {
    const ctx = await givenTwoMemberSeason();
    const res = await ctx.call("GET", "/seasons/not-a-uuid/progress", "andrea");
    expect(res.status).toBe(422);
  });
});
