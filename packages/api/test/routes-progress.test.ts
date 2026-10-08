import { seasonId } from "@pactjoy/app";
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
