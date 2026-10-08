import { describe, expect, it } from "vitest";
import { givenActiveSeason, givenTwoMemberSeason } from "./entries-fixture.ts";
import { UNKNOWN_CIRCLE } from "./harness.ts";

describe("GET /seasons/:seasonId/weeks/:weekIndex/summary (A2s)", () => {
  it("returns 200 with full WeekSummaryDto for circle member", async () => {
    const ctx = await givenTwoMemberSeason();
    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/weeks/0/summary`, "andrea");

    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      weekIndex: 0,
      timing: "current",
      facts: { counted: false, editable: true, final: false },
      points: 0,
      consistency: null,
      idealCompletion: null,
      headline: null,
      weeksLeft: 3,
      season: { id: ctx.seasonId, lengthWeeks: 4 },
    });
    expect(res.json.data.viewerId).toBeDefined();
    expect(res.json.data.commitments).toHaveLength(1);
    expect(res.json.data.commitments[0]).toMatchObject({
      habit: { name: "Run andrea" },
      points: 0,
    });
    expect(res.json.data.circle).toHaveLength(2);
  });

  it("returns circle: null for solo circle", async () => {
    const ctx = await givenActiveSeason();
    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/weeks/0/summary`, "andrea");

    expect(res.status).toBe(200);
    expect(res.json.data.circle).toBeNull();
  });

  it("returns 401 when unauthenticated", async () => {
    const ctx = await givenTwoMemberSeason();
    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/weeks/0/summary`, null);
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not a member of the circle", async () => {
    const ctx = await givenActiveSeason();
    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/weeks/0/summary`, "victor");
    expect(res.status).toBe(403);
    expect(res.json.error?.code).toBe("NotAMember");
  });

  it("returns 404 when season does not exist", async () => {
    const ctx = await givenTwoMemberSeason();
    const res = await ctx.call("GET", `/seasons/${UNKNOWN_CIRCLE}/weeks/0/summary`, "andrea");
    expect(res.status).toBe(404);
    expect(res.json.error?.code).toBe("SeasonNotFound");
  });

  it("returns 404 when weekIndex is out of range", async () => {
    const ctx = await givenTwoMemberSeason();
    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/weeks/99/summary`, "andrea");
    expect(res.status).toBe(404);
    expect(res.json.error?.code).toBe("SeasonNotFound");
  });

  it("returns 422 when seasonId is not a valid UUID", async () => {
    const ctx = await givenTwoMemberSeason();
    const res = await ctx.call("GET", "/seasons/not-a-uuid/weeks/0/summary", "andrea");
    expect(res.status).toBe(422);
    expect(res.json.error?.code).toBe("InvalidRequest");
  });

  it.each(["-1", "abc", "1.5"])(
    "returns 422 when weekIndex is invalid (%s)",
    async (invalidWeek) => {
      const ctx = await givenTwoMemberSeason();
      const res = await ctx.call(
        "GET",
        `/seasons/${ctx.seasonId}/weeks/${invalidWeek}/summary`,
        "andrea",
      );
      expect(res.status).toBe(422);
      expect(res.json.error?.code).toBe("InvalidRequest");
    },
  );
});
