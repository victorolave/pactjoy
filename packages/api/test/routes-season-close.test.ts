import { instant } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { givenTwoMemberSeason } from "./entries-fixture.ts";

// The season is 4 weeks long (cadence 1) and starts 2023-11-14 (day 1, America/Bogota): the closing
// review (period 4) is due from day 29 = 2023-12-12, results and the closure open on day 30 =
// 2023-12-13, and a week later (2023-12-19) the circle may open its next season without laggards.
const at = (month: number, day: number) => instant(Date.UTC(2023, month - 1, day, 17));
const UNKNOWN = "cccccccc-0000-4000-8000-000000000000";

type Who = "andrea" | "victor";

async function given(options: { closingReviews?: boolean } = {}) {
  const ctx = await givenTwoMemberSeason();
  ctx.setNow(at(12, 12));
  if (options.closingReviews !== false) {
    for (const who of ["andrea", "victor"] as const) {
      const done = await ctx.call("POST", `/seasons/${ctx.seasonId}/reviews/4`, who, {
        reflection: { helped: null, hard: null },
        automaticity: [{ commitmentId: ctx.commitmentIds[who], items: [4, 4, 5, 5] }],
      });
      expect([who, done.status]).toEqual([who, 201]);
    }
  }
  const body = (who: Who, decision = "continue") => ({
    decisions: [{ commitmentId: ctx.commitmentIds[who], decision }],
  });
  const close = (who: Who, decision = "continue") =>
    ctx.call("POST", `/seasons/${ctx.seasonId}/closure`, who, body(who, decision));
  return { ...ctx, body, close, results: `/seasons/${ctx.seasonId}/results` };
}

describe("401 on every season-closure route", () => {
  it("rejects a missing token on all four", async () => {
    const { call, seasonId } = await given();
    const results = await Promise.all([
      call("GET", `/seasons/${seasonId}/results`, null),
      call("POST", `/seasons/${seasonId}/closure`, null, { decisions: [] }),
      call("GET", `/seasons/${seasonId}/carry-over`, null),
      call("GET", "/me/seasons", null),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401]);
  });
});

describe("GET /seasons/:seasonId/results", () => {
  it("409 SeasonResultsNotYet names the date before the results day", async () => {
    const { call, results } = await given();
    const res = await call("GET", results, "andrea");
    expect([res.status, res.json.error.code, res.json.error.details]).toEqual([
      409,
      "SeasonResultsNotYet",
      { availableOn: "2023-12-13" },
    ]);
  });

  it("200 the owner's results with exactly the documented keys", async () => {
    const { call, results, setNow, commitmentIds } = await given();
    setNow(at(12, 13));

    const res = await call("GET", results, "andrea");

    expect(res.status).toBe(200);
    expect(Object.keys(res.json.data).sort()).toEqual([
      "actualStart",
      "closingReviewDone",
      "closure",
      "commitments",
      "lastDay",
      "lengthWeeks",
      "seasonId",
      "standings",
      "status",
      "totals",
    ]);
    expect(res.json.data).toMatchObject({
      status: "active",
      lengthWeeks: 4,
      actualStart: "2023-11-14",
      lastDay: "2023-12-11",
      closingReviewDone: true,
      closure: null,
    });
    expect(Object.keys(res.json.data.totals).sort()).toEqual([
      "consistencyPercent",
      "idealPercent",
      "points",
    ]);
    expect(Object.keys(res.json.data.standings).sort()).toEqual(["gap", "memberCount", "rank"]);
    expect(res.json.data.commitments).toHaveLength(1);
    expect(Object.keys(res.json.data.commitments[0]).sort()).toEqual([
      "automaticity",
      "commitmentId",
      "consistencyPercent",
      "habitId",
      "habitName",
      "icon",
      "idealPercent",
      "points",
      "stage",
    ]);
    expect(res.json.data.commitments[0]).toMatchObject({
      commitmentId: commitmentIds.andrea,
      habitName: "Run andrea",
      automaticity: { from: null, to: "4,5" },
      stage: "new",
    });
  });

  it("the viewer's own commitments only: a peer's never appears", async () => {
    const { call, results, setNow, commitmentIds } = await given();
    setNow(at(12, 13));
    const res = await call("GET", results, "victor");
    expect(res.json.data.commitments.map((c: { commitmentId: string }) => c.commitmentId)).toEqual([
      commitmentIds.victor,
    ]);
  });

  it("404 for an unknown season; no route carries a member id", async () => {
    const { call, seasonId } = await given();
    expect((await call("GET", `/seasons/${UNKNOWN}/results`, "andrea")).status).toBe(404);
    for (const path of [
      `/seasons/${seasonId}/members/${UNKNOWN}/results`,
      `/seasons/${seasonId}/members/${UNKNOWN}/closure`,
    ]) {
      const res = await call("GET", path, "andrea");
      expect([path, res.status, res.json.error.code]).toEqual([path, 404, "RouteNotFound"]);
    }
  });
});

describe("POST /seasons/:seasonId/closure", () => {
  it("201 stores the closure; the last closer closes the season", async () => {
    const { call, close, setNow, seasonId } = await given();
    setNow(at(12, 13));

    const first = await close("andrea");
    expect(first.status).toBe(201);
    expect(first.json.data).toEqual({
      decidedAt: "2023-12-13T17:00:00.000Z",
      decisions: [{ commitmentId: expect.any(String), decision: "continue" }],
      graduatedHabitIds: [],
      seasonClosed: false,
    });

    const last = await close("victor");
    expect(last.status).toBe(201);
    expect(last.json.data.seasonClosed).toBe(true);
    const view = await call("GET", `/seasons/${seasonId}`, "andrea");
    expect(view.json.data.status).toBe("closed");
  });

  it("a graduate decision graduates the habit, listed by id", async () => {
    const { call, close, setNow } = await given();
    setNow(at(12, 13));

    const res = await close("andrea", "graduate");

    expect(res.status).toBe(201);
    expect(res.json.data.graduatedHabitIds).toHaveLength(1);
    const habits = await call("GET", "/habits", "andrea");
    expect(habits.json.data.habits[0].graduatedAt).toBe("2023-12-13T17:00:00.000Z");
  });

  it("409 ClosureAlreadySubmitted, and the first closure stands", async () => {
    const { close, setNow } = await given();
    setNow(at(12, 13));
    await close("andrea");
    const again = await close("andrea", "pause");
    expect([again.status, again.json.error.code]).toEqual([409, "ClosureAlreadySubmitted"]);
  });

  it("409 ClosingReviewRequired without the closing review", async () => {
    const { close, setNow } = await given({ closingReviews: false });
    setNow(at(12, 13));
    const res = await close("andrea");
    expect([res.status, res.json.error.code]).toEqual([409, "ClosingReviewRequired"]);
  });

  it("409 SeasonResultsNotYet on the grace day", async () => {
    const { close } = await given();
    const res = await close("andrea");
    expect([res.status, res.json.error.code, res.json.error.details]).toEqual([
      409,
      "SeasonResultsNotYet",
      { availableOn: "2023-12-13" },
    ]);
  });

  it("422 for a decision that does not exist or a closure that does not cover the commitments", async () => {
    const { call, setNow, seasonId, commitmentIds } = await given();
    setNow(at(12, 13));
    const path = `/seasons/${seasonId}/closure`;

    const bad = await call("POST", path, "andrea", {
      decisions: [{ commitmentId: commitmentIds.andrea, decision: "maybe" }],
    });
    expect([bad.status, bad.json.error.code, bad.json.error.details]).toEqual([
      422,
      "InvalidClosureDecision",
      { commitmentId: commitmentIds.andrea },
    ]);

    const empty = await call("POST", path, "andrea", { decisions: [] });
    expect([empty.status, empty.json.error.code, empty.json.error.details]).toEqual([
      422,
      "ClosureIncomplete",
      { commitmentIds: [commitmentIds.andrea] },
    ]);
  });

  it("403 CommitmentNotOwned for someone else's commitment", async () => {
    const { call, setNow, seasonId, commitmentIds } = await given();
    setNow(at(12, 13));
    const res = await call("POST", `/seasons/${seasonId}/closure`, "andrea", {
      decisions: [{ commitmentId: commitmentIds.victor, decision: "continue" }],
    });
    expect([res.status, res.json.error.code]).toEqual([403, "CommitmentNotOwned"]);
  });

  it("422 InvalidRequest for a malformed body", async () => {
    const { call, setNow, seasonId } = await given();
    setNow(at(12, 13));
    for (const body of [{}, { decisions: "x" }, { decisions: [{ decision: "continue" }] }]) {
      const res = await call("POST", `/seasons/${seasonId}/closure`, "andrea", body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 422]);
    }
  });
});

describe("carry-over and history", () => {
  /** Both close on day 30, then Andrea opens the next season (pact open). */
  async function givenNextSeason(decision: string) {
    const ctx = await given();
    ctx.setNow(at(12, 13));
    await ctx.close("andrea", decision);
    await ctx.close("victor");
    const next = await ctx.call("POST", `/circles/${ctx.circleId}/seasons`, "andrea", {
      timezone: "America/Bogota",
      startDate: "2023-12-14",
      lengthWeeks: 4,
    });
    expect(next.status).toBe(201);
    return { ...ctx, nextSeasonId: next.json.data.id as string };
  }

  it("GET carry-over: 200 the owner's defaults from the previous season", async () => {
    const { call, nextSeasonId, seasonId } = await givenNextSeason("adjust");
    const res = await call("GET", `/seasons/${nextSeasonId}/carry-over`, "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({
      previousSeasonId: seasonId,
      items: [
        {
          habitId: expect.any(String),
          decision: "adjust",
          previous: {
            measure: { unit: "done", schedule: expect.anything() },
            weightPercent: 100,
            privacy: "visible",
          },
        },
      ],
    });
  });

  it("GET carry-over: a graduate decision comes back as nothing", async () => {
    const { call, nextSeasonId } = await givenNextSeason("graduate");
    const res = await call("GET", `/seasons/${nextSeasonId}/carry-over`, "andrea");
    expect(res.json.data.items).toEqual([]);
  });

  it("GET carry-over: 409 PactNotOpen on a season that is not in its pact", async () => {
    const { call, seasonId } = await given();
    const res = await call("GET", `/seasons/${seasonId}/carry-over`, "andrea");
    expect([res.status, res.json.error.code]).toEqual([409, "PactNotOpen"]);
  });

  it("POST commitments: 409 HabitGraduated for a graduated habit", async () => {
    const { call, nextSeasonId, commitmentIds } = await givenNextSeason("graduate");
    const habits = await call("GET", "/habits", "andrea");
    const res = await call("POST", `/seasons/${nextSeasonId}/commitments`, "andrea", {
      habitId: habits.json.data.habits[0].id,
      weightPercent: 100,
      privacy: "visible",
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
    });
    expect([res.status, res.json.error.code]).toEqual([409, "HabitGraduated"]);
    expect(commitmentIds.andrea).toBeDefined();
  });

  it("GET /me/seasons lists the closed seasons the viewer took part in", async () => {
    const { call, seasonId } = await givenNextSeason("continue");
    const res = await call("GET", "/me/seasons", "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({
      seasons: [
        {
          seasonId,
          lengthWeeks: 4,
          actualStart: "2023-11-14",
          lastDay: "2023-12-11",
          points: 0,
          rank: null,
          memberCount: 2,
          closedByMe: true,
        },
      ],
    });
  });

  it("GET /me/seasons is empty before any season closed", async () => {
    const { call } = await given();
    const res = await call("GET", "/me/seasons", "andrea");
    expect(res.json.data).toEqual({ seasons: [] });
  });
});
