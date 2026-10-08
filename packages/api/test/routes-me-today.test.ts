import { instant, localDate, seasonId } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";
import { givenTwoMemberSeason } from "./entries-fixture.ts";
import { ANDREA, setup, VICTOR } from "./harness.ts";
import { givenSeason } from "./season-fixture.ts";

// The clock sits on 2023-11-14 (America/Bogota), which is season day 0.
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
const WEEKLY = { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

async function givenCircle() {
  const ctx = setup();
  const circle = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
  return { ...ctx, circleId: circle.json.data.id as string };
}

describe("GET /me/today (TD-R1, TD-S11)", () => {
  it("401 without a token and with an unknown one", async () => {
    const { call } = setup();
    const none = await call("GET", "/me/today", null);
    const bad = await call("GET", "/me/today", "nobody");
    expect([none.status, bad.status]).toEqual([401, 401]);
  });

  it("noCircle: just the state, no today and no zone", async () => {
    const { call } = setup();
    const res = await call("GET", "/me/today", "andrea");
    expect([res.status, res.json]).toEqual([200, { data: { state: "noCircle" } }]);
  });

  it("noSeason: the circle, nothing else", async () => {
    const { call, circleId } = await givenCircle();
    const res = await call("GET", "/me/today", "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ state: "noSeason", circle: { id: circleId, name: "Crew" } });
  });

  it("pactOpen: season summary in the season zone, no rows", async () => {
    const { call, circleId } = await givenCircle();
    const season = await call("POST", `/circles/${circleId}/seasons`, "andrea", {
      timezone: "America/Bogota",
      startDate: "2023-11-14",
      lengthWeeks: 4,
    });
    const res = await call("GET", "/me/today", "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      state: "pactOpen",
      today: "2023-11-14",
      timeZone: "America/Bogota",
      circle: { id: circleId, name: "Crew" },
      season: { id: season.json.data.id, lengthWeeks: 4, nominalStart: "2023-11-14" },
    });
    expect(res.json.data.season.actualStart).toBeNull();
    expect(res.json.data.myCommitments).toEqual([]);
    expect(res.json.data).not.toHaveProperty("rows");
    expect(res.json.data).not.toHaveProperty("standings");
    expect(keysDeep(res.json).has("userId")).toBe(false);
  });

  it("notStarted: the season begins in the future", async () => {
    const ctx = await givenCircle();
    const season = await ctx.call("POST", `/circles/${ctx.circleId}/seasons`, "andrea", {
      timezone: "America/Bogota",
      startDate: "2023-11-20",
      lengthWeeks: 4,
    });
    const seasonId: string = season.json.data.id;
    const habit = await ctx.call("POST", "/habits", "andrea", { name: "Run" });
    const added = await ctx.call("POST", `/seasons/${seasonId}/commitments`, "andrea", {
      habitId: habit.json.data.id,
      weightPercent: 100,
      privacy: "visible",
      measure: DAILY,
    });
    await ctx.call("PUT", `/seasons/${seasonId}/approval`, "andrea", {
      expectedPactRevision: added.json.data.pactRevision,
    });
    const res = await ctx.call("GET", "/me/today", "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data.state).toBe("notStarted");
    expect(res.json.data.myCommitments).toEqual([
      {
        id: added.json.data.commitments[0].id,
        habitName: "Run",
        icon: null,
        weightPercent: 100,
        maxPoints: 1000,
      },
    ]);
    expect(res.json.data.today).toBe("2023-11-14");
    expect(res.json.data).not.toHaveProperty("rows");
  });

  it.each(["pactOpen", "notStarted"] as const)(
    "SR-R2: %s returns no commitments for a caller with none, even when others have them",
    async (state) => {
      const ctx = await givenSeason();
      const stored = await ctx.app.seasons.get(seasonId(ctx.path.slice("/seasons/".length)));
      if (!stored) throw new Error("fixture setup failed");
      expect(stored.commitments).toHaveLength(2);
      if (state === "notStarted") {
        await ctx.app.seasons.save(
          { ...stored, status: "active", actualStart: localDate("2023-11-15") },
          stored.version,
        );
      }
      const res = await ctx.call("GET", "/me/today", "victor");
      expect([res.status, res.json.data.state, res.json.data.myCommitments]).toEqual([
        200,
        state,
        [],
      ]);
      expect(JSON.stringify(res.json)).not.toContain("Secret-habit");
      expect(JSON.stringify(res.json)).not.toContain("Open-habit");
    },
  );

  it("active: viewer, rows, summary and standings as plain JSON, no userId", async () => {
    const { call, seasonId, commitmentIds, circleId, app } = await givenTwoMemberSeason(DAILY);
    await call("POST", `/seasons/${seasonId}/entries`, "andrea", {
      commitmentId: commitmentIds.andrea,
      value: { kind: "quantity", value: "30" },
      note: "my own note",
      clientRequestId: "req-a1",
    });
    const circle = await app.circles.get(circleId as never);
    const andreaMember = circle?.members.find((m) => m.userId === ANDREA)?.id;

    const res = await call("GET", "/me/today", "andrea");
    expect(res.status).toBe(200);
    const data = res.json.data;
    expect(data).toMatchObject({
      state: "active",
      viewerId: andreaMember,
      today: "2023-11-14",
      timeZone: "America/Bogota",
      circle: { id: circleId, name: "Crew" },
      season: { id: seasonId, lengthWeeks: 4, actualStart: "2023-11-14" },
      summary: { week: 1, weekCount: 4, daysLeft: 27 },
    });
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({
      kind: "day",
      commitmentId: commitmentIds.andrea,
      habitName: "Run andrea",
      privacy: "visible",
      scheduledToday: true,
      opportunity: { state: "logged", graceUntil: "2023-11-15" },
    });
    expect(data.rows[0].entries).toHaveLength(1);
    expect(data.rows[0].entries[0]).toMatchObject({
      forDate: "2023-11-14",
      value: { kind: "quantity", value: "30" },
      note: "my own note",
    });
    expect(data.rows[0].entries[0].forDate).toMatch(ISO_DATE);
    expect(data.summary.score.points).toBeGreaterThan(0);
    expect(data.standings.kind).toBe("ranked");
    expect(data.standings.rows).toHaveLength(2);
    expect(keysDeep(res.json).has("userId")).toBe(false);
    expect(JSON.stringify(res.json)).not.toContain(VICTOR);
    expect(JSON.stringify(res.json)).not.toContain(ANDREA);
  });

  it("active week row: progress with sessions and a numeric percent", async () => {
    const { call, seasonId, commitmentIds } = await givenTwoMemberSeason(WEEKLY);
    await call("POST", `/seasons/${seasonId}/entries`, "victor", {
      commitmentId: commitmentIds.victor,
      value: { kind: "done" },
      clientRequestId: "req-v1",
    });
    const res = await call("GET", "/me/today", "victor");
    const row = res.json.data.rows[0];
    expect(row.kind).toBe("week");
    expect(row.progress).toMatchObject({ sessionsDone: 1, sessionsTarget: 3 });
    expect(typeof row.progress.percent).toBe("number");
    expect(row).not.toHaveProperty("scheduledToday");
  });

  it("ended: the row describes the last season day", async () => {
    const { call, setNow } = await givenTwoMemberSeason(DAILY);
    // 2023-12-12 12:00 in Bogota is day 28, the first day after the 4-week season.
    setNow(instant(Date.UTC(2023, 11, 12, 17)));
    const res = await call("GET", "/me/today", "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data.state).toBe("ended");
    expect(res.json.data.today).toBe("2023-12-12");
    expect(res.json.data.summary).toMatchObject({ week: 4, daysLeft: 0 });
    expect(res.json.data.rows[0].opportunity.state).toBe("open");
  });

  it("ended, on the last week's grace day: score and standings match the score endpoints", async () => {
    const { call, setNow, path, seasonId, commitmentIds } = await givenTwoMemberSeason(WEEKLY);
    // Days 21-23 (2023-12-05..07, noon in Bogota): Andrea logs the 3 sessions of the last week.
    for (const day of [5, 6, 7]) {
      setNow(instant(Date.UTC(2023, 11, day, 17)));
      const logged = await call("POST", path, "andrea", {
        commitmentId: commitmentIds.andrea,
        value: { kind: "done" },
        clientRequestId: `last-week-${day}`,
      });
      expect(logged.status).toBe(201);
    }
    // Day 28 (2023-12-12) is that week's grace deadline: its sessions count from today.
    setNow(instant(Date.UTC(2023, 11, 12, 17)));

    const todayRes = await call("GET", "/me/today", "andrea");
    const score = await call("GET", `/seasons/${seasonId}/score`, "andrea");
    const ranked = await call("GET", `/seasons/${seasonId}/standings`, "andrea");

    expect(todayRes.json.data.state).toBe("ended");
    // 3 of 12 weekly sessions: 1000 x 3/12 = 250.
    expect(todayRes.json.data.summary.score.points).toBe(250);
    expect(todayRes.json.data.summary.score).toEqual(score.json.data);
    expect(todayRes.json.data.standings).toEqual(ranked.json.data);
  });

  it("another member's private commitment never appears in my rows or anywhere", async () => {
    const ctx = setup();
    const circle = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
    const circleId: string = circle.json.data.id;
    const invite = await ctx.call("POST", `/circles/${circleId}/invite`, "andrea");
    await ctx.call("POST", "/circles/join", "victor", joinCircleBody(invite.json.data.code));
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
    for (const who of ["andrea", "victor"] as const) {
      await ctx.call("PUT", `/seasons/${seasonId}/approval`, who, {
        expectedPactRevision: pactRevision,
      });
    }
    const asAndrea = await ctx.call("GET", "/me/today", "andrea");
    expect(asAndrea.status).toBe(200);
    expect(asAndrea.json.data.rows.map((r: { habitName: string }) => r.habitName)).toEqual([
      "Secret andrea",
    ]);
    expect(JSON.stringify(asAndrea.json)).not.toContain("Secret victor");
    // Victor sees his own private commitment in full.
    const asVictor = await ctx.call("GET", "/me/today", "victor");
    expect(asVictor.json.data.rows[0]).toMatchObject({
      habitName: "Secret victor",
      privacy: "private",
      measure: { unit: "minutes" },
    });
    expect(JSON.stringify(asVictor.json)).not.toContain("Secret andrea");
  });

  it("is a read: one uow.read, no write transaction; query parameters are ignored", async () => {
    const { call, transaction, read } = await givenTwoMemberSeason(DAILY);
    const t = transaction.mock.calls.length;
    const r = read.mock.calls.length;
    const res = await call("GET", "/me/today?today=1999-01-01&userId=x", "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data.today).toBe("2023-11-14");
    expect(transaction.mock.calls.length).toBe(t);
    expect(read.mock.calls.length).toBe(r + 1);
  });

  it("is GET only", async () => {
    const { call } = setup();
    const res = await call("POST", "/me/today", "andrea", {});
    expect(res.status).toBe(405);
  });
});
