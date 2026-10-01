import { describe, expect, it } from "vitest";
import { givenTwoMemberSeason } from "./entries-fixture.ts";
import { ANDREA, setup, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

// Every weekday scheduled (0-6): today already counts, so one logged day scores immediately.
const DAILY = {
  unit: "minutes",
  direction: "reach",
  minimum: "10",
  ideal: "30",
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};
const UPPER_ID = "ABCDEF00-0000-4000-8000-000000000000";

const FORBIDDEN_KEYS = ["userId", "requestFingerprint", "note", "clientRequestId"];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

/** Two members, a season already active; Victor logs one session, Andrea none. */
async function givenScored(measure: object = DAILY) {
  const ctx = await givenTwoMemberSeason(measure);
  await ctx.call("POST", ctx.path, "victor", {
    commitmentId: ctx.commitmentIds.victor,
    value: { kind: "quantity", value: "30" },
    note: "private words",
    clientRequestId: "req-v1",
  });
  const circle = await ctx.app.circles.get(ctx.circleId as never);
  const memberOf = (token: "andrea" | "victor") =>
    circle?.members.find((m) => m.userId === (token === "andrea" ? ANDREA : VICTOR))?.id as string;
  return { ...ctx, memberOf };
}

/** A circle whose only season starts in the future: nothing to score yet (Andrea holds a commitment). */
async function givenFutureSeason() {
  const ctx = setup();
  const circle = await ctx.call("POST", "/circles", "andrea", { name: "Crew" });
  const season = await ctx.call("POST", `/circles/${circle.json.data.id}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate: "2023-11-20",
    lengthWeeks: 4,
  });
  const seasonId: string = season.json.data.id;
  const habit = await ctx.call("POST", "/habits", "andrea", { name: "Run" });
  await ctx.call("POST", `/seasons/${seasonId}/commitments`, "andrea", {
    habitId: habit.json.data.id,
    weightPercent: 100,
    privacy: "visible",
    measure: DAILY,
  });
  return { ...ctx, seasonId };
}

describe("GET /seasons/:seasonId/score (UE-E-S11)", () => {
  it("own score: scope own with consistency and idealCompletion, 200, no userId", async () => {
    const { call, seasonId, memberOf } = await givenScored();
    const res = await call("GET", `/seasons/${seasonId}/score`, "victor");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      kind: "scored",
      scope: "own",
      memberId: memberOf("victor"),
    });
    expect(res.json.data).toHaveProperty("consistency");
    expect(res.json.data).toHaveProperty("idealCompletion");
    expect(res.json.data.points).toBeGreaterThan(0);
    for (const key of FORBIDDEN_KEYS) expect(keysDeep(res.json).has(key)).toBe(false);
  });

  it("the caller's own memberId in the path is the same own view", async () => {
    const { call, seasonId, memberOf } = await givenScored();
    const bare = await call("GET", `/seasons/${seasonId}/score`, "victor");
    const named = await call(
      "GET",
      `/seasons/${seasonId}/members/${memberOf("victor")}/score`,
      "victor",
    );
    expect(named.json).toEqual(bare.json);
  });

  it("another member's score: scope others with only points, never their note", async () => {
    const { call, seasonId, memberOf } = await givenScored();
    const res = await call(
      "GET",
      `/seasons/${seasonId}/members/${memberOf("victor")}/score`,
      "andrea",
    );
    expect(res.status).toBe(200);
    expect(res.json.data.scope).toBe("others");
    expect(res.json.data.memberId).toBe(memberOf("victor"));
    expect(res.json.data).not.toHaveProperty("consistency");
    expect(res.json.data).not.toHaveProperty("idealCompletion");
    expect(JSON.stringify(res.json)).not.toContain("private words");
    for (const key of FORBIDDEN_KEYS) expect(keysDeep(res.json).has(key)).toBe(false);
  });

  it("Q2 default: another member's private commitment is hidden (no habit or thresholds)", async () => {
    const ctx = setup();
    const circle = await ctx.call("POST", "/circles", "andrea", { name: "Crew" });
    const circleId: string = circle.json.data.id;
    const invite = await ctx.call("POST", `/circles/${circleId}/invite`, "andrea");
    await ctx.call("POST", "/circles/join", "victor", { inviteCode: invite.json.data.code });
    const season = await ctx.call("POST", `/circles/${circleId}/seasons`, "andrea", {
      timezone: "America/Bogota",
      startDate: "2023-11-14",
      lengthWeeks: 4,
    });
    const seasonId: string = season.json.data.id;
    let pactRevision = 0;
    for (const who of ["andrea", "victor"] as const) {
      const habit = await ctx.call("POST", "/habits", who, { name: `Secret ${who}` });
      const added = await ctx.call("POST", `/seasons/${seasonId}/commitments`, who, {
        habitId: habit.json.data.id,
        weightPercent: 100,
        privacy: who === "victor" ? "private" : "visible",
        measure: DAILY,
      });
      pactRevision = added.json.data.pactRevision;
    }
    // Approvals only after every commitment is in: adding one resets them.
    for (const who of ["andrea", "victor"] as const) {
      await ctx.call("PUT", `/seasons/${seasonId}/approval`, who, {
        expectedPactRevision: pactRevision,
      });
    }
    const stored = await ctx.app.circles.get(circleId as never);
    const victor = stored?.members.find((m) => m.userId === VICTOR)?.id as string;
    const seen = await ctx.call("GET", `/seasons/${seasonId}/members/${victor}/score`, "andrea");
    expect(seen.status).toBe(200);
    expect(seen.json.data.commitments.map((x: { kind: string }) => x.kind)).toEqual(["hidden"]);
    expect(Object.keys(seen.json.data.commitments[0]).sort()).toEqual([
      "commitmentId",
      "kind",
      "points",
      "weightPercent",
    ]);
    expect(JSON.stringify(seen.json)).not.toContain("Secret");
    expect(keysDeep(seen.json).has("habitId")).toBe(false);
    const own = await ctx.call("GET", `/seasons/${seasonId}/score`, "victor");
    expect(own.json.data.commitments.map((x: { kind: string }) => x.kind)).toEqual(["detail"]);
  });

  it("a member who left keeps read-only access to score and standings", async () => {
    const { call, circleId, seasonId } = await givenScored();
    const left = await call("POST", `/circles/${circleId}/leave`, "victor");
    expect(left.status).toBe(200);
    const score = await call("GET", `/seasons/${seasonId}/score`, "victor");
    expect(score.status).toBe(200);
    const standings = await call("GET", `/seasons/${seasonId}/standings`, "victor");
    expect(standings.status).toBe(200);
  });

  it("notStarted while the season has not begun (UE-E-S12)", async () => {
    const { call, seasonId } = await givenFutureSeason();
    const res = await call("GET", `/seasons/${seasonId}/score`, "andrea");
    expect([res.status, res.json]).toEqual([200, { data: { kind: "notStarted" } }]);
  });

  it("is a read: uow.read only, no write transaction (AC-S7)", async () => {
    const { call, seasonId, transaction, read } = await givenScored();
    const t = transaction.mock.calls.length;
    const r = read.mock.calls.length;
    await call("GET", `/seasons/${seasonId}/score`, "victor");
    expect(transaction.mock.calls.length).toBe(t);
    expect(read.mock.calls.length).toBe(r + 1);
  });

  it("422 with no repository call: bad or upper-case ids", async () => {
    const { call, transaction, read, seasonId } = await givenScored();
    const t = transaction.mock.calls.length;
    const r = read.mock.calls.length;
    for (const path of [
      "/seasons/nope/score",
      `/seasons/${seasonId}/members/nope/score`,
      `/seasons/${UPPER_ID}/score`,
      `/seasons/${seasonId}/members/${UPPER_ID}/score`,
    ]) {
      const res = await call("GET", path, "andrea");
      expect([path, res.status, res.json.error.code]).toEqual([path, 422, "InvalidRequest"]);
    }
    expect(transaction.mock.calls.length).toBe(t);
    expect(read.mock.calls.length).toBe(r);
  });

  it("app errors map: unknown season 404, unknown member 404, non-member 403 (UE-E-S13)", async () => {
    const { call, seasonId } = await givenScored();
    const missing = await call("GET", `/seasons/${UNKNOWN_CIRCLE}/score`, "andrea");
    expect([missing.status, missing.json.error.code]).toEqual([404, "SeasonNotFound"]);

    const ghost = await call(
      "GET",
      `/seasons/${seasonId}/members/${UNKNOWN_CIRCLE}/score`,
      "andrea",
    );
    expect([ghost.status, ghost.json.error.code]).toEqual([404, "MemberNotFound"]);

    const solo = await givenFutureSeason();
    const stranger = await solo.call("GET", `/seasons/${solo.seasonId}/score`, "victor");
    expect([stranger.status, stranger.json.error.code]).toEqual([403, "NotAMember"]);
  });

  it("401 without a token or with an unknown one", async () => {
    const { call, seasonId } = await givenScored();
    for (const token of [null, "bogus"]) {
      const res = await call("GET", `/seasons/${seasonId}/score`, token);
      expect([res.status, res.json.error.code]).toEqual([401, "Unauthorized"]);
    }
  });
});

describe("GET /seasons/:seasonId/standings (UE-E-S11..S14)", () => {
  it("ranked rows with member ids and points only, count equals rows", async () => {
    const { call, seasonId, memberOf } = await givenScored();
    const res = await call("GET", `/seasons/${seasonId}/standings`, "andrea");
    expect(res.status).toBe(200);
    const { kind, rows, eligibleParticipantCount } = res.json.data;
    expect(kind).toBe("ranked");
    expect(eligibleParticipantCount).toBe(rows.length);
    expect(rows.map((r: { memberId: string }) => r.memberId)).toEqual([
      memberOf("victor"),
      memberOf("andrea"),
    ]);
    expect(rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2]);
    expect(Object.keys(rows[0]).sort()).toEqual(["memberId", "points", "rank"]);
    expect(JSON.stringify(res.json)).not.toContain("private words");
  });

  it("a tie shares the rank (UE-E-S14)", async () => {
    const ctx = await givenTwoMemberSeason(DAILY);
    const res = await ctx.call("GET", `/seasons/${ctx.seasonId}/standings`, "victor");
    expect(res.json.data.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 1]);
    expect(res.json.data.eligibleParticipantCount).toBe(2);
  });

  it("notStarted before the season begins", async () => {
    const { call, seasonId } = await givenFutureSeason();
    const res = await call("GET", `/seasons/${seasonId}/standings`, "andrea");
    expect([res.status, res.json]).toEqual([200, { data: { kind: "notStarted" } }]);
  });

  it("uow.read only; 422 with no repository call; 404, 401", async () => {
    const { call, seasonId, transaction, read } = await givenScored();
    const t = transaction.mock.calls.length;
    const r = read.mock.calls.length;
    await call("GET", `/seasons/${seasonId}/standings`, "andrea");
    expect(transaction.mock.calls.length).toBe(t);
    expect(read.mock.calls.length).toBe(r + 1);

    const bad = await call("GET", "/seasons/nope/standings", "andrea");
    expect(bad.status).toBe(422);
    expect(read.mock.calls.length).toBe(r + 1);

    const missing = await call("GET", `/seasons/${UNKNOWN_CIRCLE}/standings`, "andrea");
    expect([missing.status, missing.json.error.code]).toEqual([404, "SeasonNotFound"]);
    const anon = await call("GET", `/seasons/${seasonId}/standings`, null);
    expect(anon.status).toBe(401);
  });

  it("non-member 403", async () => {
    const solo = await givenFutureSeason();
    const res = await solo.call("GET", `/seasons/${solo.seasonId}/standings`, "victor");
    expect([res.status, res.json.error.code]).toEqual([403, "NotAMember"]);
  });
});
