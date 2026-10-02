import { describe, expect, it } from "vitest";
import { createCircleBody } from "../src/testing/index.ts";
import { setup, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

const DONE = { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } };
const NOWHERE = `/seasons/${UNKNOWN_CIRCLE}/approval`;

async function givenSeason(weightPercent = 100, privacy = "visible") {
  const ctx = setup();
  const circle = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
  const season = await ctx.call("POST", `/circles/${circle.json.data.id}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate: "2023-11-15",
    lengthWeeks: 4,
  });
  const habit = await ctx.call("POST", "/habits", "andrea", { name: "Run" });
  const seasonId: string = season.json.data.id;
  const committed = await ctx.call("POST", `/seasons/${seasonId}/commitments`, "andrea", {
    habitId: habit.json.data.id,
    weightPercent,
    privacy,
    measure: DONE,
  });
  // Adding the commitment changed the pact: the caller approves the revision it now sees.
  const pactRevision: number = committed.json.data.pactRevision;
  return {
    ...ctx,
    seasonId,
    pactRevision,
    body: { expectedPactRevision: pactRevision },
    path: `/seasons/${seasonId}/approval`,
  };
}

/** Adds Victor as a second active member so one approval does not close the pact. */
async function withSecondMember(ctx: Awaited<ReturnType<typeof givenSeason>>) {
  const season = await ctx.app.seasons.get(ctx.seasonId as never);
  const circle = await ctx.app.circles.get(season?.circleId as never);
  if (!season || !circle) throw new Error("fixture setup failed");
  const joined = {
    userId: VICTOR,
    id: "m-victor",
    status: "active",
    joinedAt: ctx.app.clock.now(),
  };
  await ctx.app.circles.save(
    { ...circle, members: [...circle.members, joined as never], version: 9 },
    circle.version,
  );
}

describe("PUT /seasons/:seasonId/approval (UE-P-S1..S3)", () => {
  it("S1: 200, a solo member's approval is unanimous and closes the pact", async () => {
    const { call, path, body } = await givenSeason();
    const { status, json } = await call("PUT", path, "andrea", body);
    expect(status).toBe(200);
    expect(json.data.status).toBe("active");
    expect(json.data.pactClosedAt).not.toBeNull();
    expect(json.data.approvals).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain("aaaaaaaa-0000-4000-8000-000000000001");
  });

  it("S1: with another active member the pact stays open and the approval is listed", async () => {
    const ctx = await givenSeason();
    await withSecondMember(ctx);
    const { status, json } = await ctx.call("PUT", ctx.path, "andrea", ctx.body);
    expect(status).toBe(200);
    expect(json.data.status).toBe("pactOpen");
    expect(json.data.approvals).toHaveLength(1);
  });

  it("S1: a private commitment is presented as hidden, with no detail", async () => {
    const { call, path, body } = await givenSeason(100, "private");
    const { json } = await call("PUT", path, "andrea", body);
    expect(json.data.commitments).toHaveLength(1);
    expect(json.data.commitments[0].kind).toBe("hidden");
    expect(JSON.stringify(json.data.commitments)).not.toContain("timesPerWeek");
  });

  it("UE-P-S7: a missing, malformed or negative expectedPactRevision is 422 with no repository call", async () => {
    const { call, path, transaction } = await givenSeason();
    const before = transaction.mock.calls.length;
    const missing = await call("PUT", path, "andrea");
    expect([missing.status, missing.json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(missing.json.error.details.issues[0]).toEqual({ path: "", problem: "required" });
    const empty = await call("PUT", path, "andrea", {});
    expect(empty.json.error.details.issues[0]).toEqual({
      path: "expectedPactRevision",
      problem: "required",
    });
    for (const bad of ["1", 1.5, -1, null, true]) {
      const res = await call("PUT", path, "andrea", { expectedPactRevision: bad });
      expect([res.status, res.json.error.code]).toEqual([422, "InvalidRequest"]);
    }
    const badId = await call("PUT", "/seasons/not-a-uuid/approval", "andrea", {
      expectedPactRevision: 0,
    });
    expect([badId.status, badId.json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(transaction.mock.calls.length).toBe(before);
  });

  it("RV-S3: an unknown body field is 422 unknownField, no repository call", async () => {
    const { call, path, transaction, body } = await givenSeason();
    const before = transaction.mock.calls.length;
    const extra = await call("PUT", path, "andrea", { ...body, force: true });
    expect([extra.status, extra.json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(extra.json.error.details.issues[0].problem).toBe("unknownField");
    expect(transaction.mock.calls.length).toBe(before);
  });

  it("UE-P-S6: a well-formed revision that differs is 409 StaleSeason with no details, and writes nothing", async () => {
    const { call, path, app, seasonId, pactRevision } = await givenSeason();
    const before = await app.seasons.get(seasonId as never);
    const res = await call("PUT", path, "andrea", { expectedPactRevision: pactRevision + 1 });
    expect([res.status, res.json.error.code]).toEqual([409, "StaleSeason"]);
    expect(res.json.error.details).toBeUndefined();
    expect(await app.seasons.get(seasonId as never)).toEqual(before);
  });

  it("S2: 409 CommitmentWeightsNotFull when the own weights are not 100%", async () => {
    const { call, path, body } = await givenSeason(50);
    const { status, json } = await call("PUT", path, "andrea", body);
    expect([status, json.error.code]).toEqual([409, "CommitmentWeightsNotFull"]);
  });

  it("S3: 404 SeasonNotFound, 403 NotAMember, 409 PactNotOpen", async () => {
    const { app, call, path, seasonId, body } = await givenSeason();
    const missing = await call("PUT", NOWHERE, "andrea", body);
    expect([missing.status, missing.json.error.code]).toEqual([404, "SeasonNotFound"]);
    const stranger = await call("PUT", path, "victor", body);
    expect([stranger.status, stranger.json.error.code]).toEqual([403, "NotAMember"]);
    expect(JSON.stringify(stranger.json)).not.toContain(VICTOR);
    const season = await app.seasons.get(seasonId as never);
    if (!season) throw new Error("fixture setup failed");
    await app.seasons.save({ ...season, status: "active", version: 9 }, season.version);
    const closed = await call("PUT", path, "andrea", body);
    expect([closed.status, closed.json.error.code]).toEqual([409, "PactNotOpen"]);
  });

  it("401 without a token", async () => {
    const { call, path, body } = await givenSeason();
    const { status, json } = await call("PUT", path, null, body);
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
  });
});

describe("DELETE /seasons/:seasonId/approval (UE-P-S4)", () => {
  it("200 removes the approval; withdrawing again is an idempotent 200", async () => {
    const ctx = await givenSeason();
    await withSecondMember(ctx);
    await ctx.call("PUT", ctx.path, "andrea", ctx.body);
    const first = await ctx.call("DELETE", ctx.path, "andrea");
    expect(first.status).toBe(200);
    expect(first.json.data.approvals).toEqual([]);
    const again = await ctx.call("DELETE", ctx.path, "andrea");
    expect(again.status).toBe(200);
    expect(again.json.data.version).toBe(first.json.data.version);
  });

  it("maps 409 PactAlreadyClosed, 404 SeasonNotFound, 403 NotAMember", async () => {
    const { call, path, body } = await givenSeason();
    await call("PUT", path, "andrea", body);
    // Closed pact: DELETE answers PactAlreadyClosed, whereas PUT answers PactNotOpen (app contract).
    const closed = await call("DELETE", path, "andrea");
    expect([closed.status, closed.json.error.code]).toEqual([409, "PactAlreadyClosed"]);
    const missing = await call("DELETE", NOWHERE, "andrea");
    expect([missing.status, missing.json.error.code]).toEqual([404, "SeasonNotFound"]);
    const stranger = await call("DELETE", path, "victor");
    expect([stranger.status, stranger.json.error.code]).toEqual([403, "NotAMember"]);
  });

  it("422 on a body field or bad id with no repository call; 401 without a token", async () => {
    const { call, path, transaction } = await givenSeason();
    const before = transaction.mock.calls.length;
    const extra = await call("DELETE", path, "andrea", { x: 1 });
    expect([extra.status, extra.json.error.code]).toEqual([422, "InvalidRequest"]);
    const badId = await call("DELETE", "/seasons/nope/approval", "andrea");
    expect(badId.status).toBe(422);
    expect(transaction.mock.calls.length).toBe(before);
    const anon = await call("DELETE", path, null);
    expect([anon.status, anon.json.error.code]).toEqual([401, "Unauthorized"]);
  });
});
