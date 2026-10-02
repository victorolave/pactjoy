import { createCircleBody } from "@pactjoy/api/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpOverPostgres, DAILY, TODAY } from "./api-http.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

const api = createHttpOverPostgres();
const admin = connect(databaseUrl());
beforeEach(() => truncateAll(admin));
afterAll(async () => {
  await truncateAll(admin); // leave the shared database clean for the next file
  await api.end();
  await admin.end();
});

describe("HTTP over Postgres: the real handler on the migrated database", () => {
  it("AC-R8/AC-S9: circle, habit, season, commitment, approve, record, replay, standings", async () => {
    const { call } = api;
    const circle = await call("POST", "/circles", "u1", createCircleBody("Crew"));
    const habit = await call("POST", "/habits", "u1", { name: "Run" });
    const season = await call("POST", `/circles/${circle.json.data.id}/seasons`, "u1", {
      timezone: "America/Bogota",
      startDate: TODAY,
      lengthWeeks: 4,
    });
    const seasonId: string = season.json.data.id;
    const added = await call("POST", `/seasons/${seasonId}/commitments`, "u1", {
      habitId: habit.json.data.id,
      weightPercent: 100,
      privacy: "visible",
      measure: DAILY,
    });
    const approved = await call("PUT", `/seasons/${seasonId}/approval`, "u1", {
      expectedPactRevision: added.json.data.pactRevision,
    });
    const entry = {
      commitmentId: added.json.data.commitments[0].id,
      value: { kind: "quantity", value: "30" },
      clientRequestId: "r-1",
    };
    const recorded = await call("POST", `/seasons/${seasonId}/entries`, "u1", entry);
    const replayed = await call("POST", `/seasons/${seasonId}/entries`, "u1", entry);
    const standings = await call("GET", `/seasons/${seasonId}/standings`, "u1");

    expect(
      [circle, habit, season, added, approved, recorded, replayed, standings].map((r) => r.status),
    ).toEqual([201, 201, 201, 201, 200, 201, 200, 200]);
    expect(recorded.json.data.replayed).toBe(false);
    expect(replayed.json.data).toEqual({ ...recorded.json.data, replayed: true });
    expect(standings.json.data.kind).toBe("ranked");
    const [row] = await admin`select count(*)::int as n from pactjoy.entries`;
    expect(row?.n).toBe(1);
  });

  it("TD-S11: GET /me/today reads the migrated database in one request (habits.getMany on Postgres)", async () => {
    const { call } = api;
    const circle = await call("POST", "/circles", "u1", createCircleBody("Crew"));
    const habit = await call("POST", "/habits", "u1", { name: "Run" });
    const season = await call("POST", `/circles/${circle.json.data.id}/seasons`, "u1", {
      timezone: "America/Bogota",
      startDate: TODAY,
      lengthWeeks: 4,
    });
    const seasonId: string = season.json.data.id;
    const added = await call("POST", `/seasons/${seasonId}/commitments`, "u1", {
      habitId: habit.json.data.id,
      weightPercent: 100,
      privacy: "visible",
      measure: DAILY,
    });
    await call("PUT", `/seasons/${seasonId}/approval`, "u1", {
      expectedPactRevision: added.json.data.pactRevision,
    });
    await call("POST", `/seasons/${seasonId}/entries`, "u1", {
      commitmentId: added.json.data.commitments[0].id,
      value: { kind: "quantity", value: "30" },
      clientRequestId: "r-today",
    });

    const res = await call("GET", "/me/today", "u1");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      state: "active",
      today: TODAY,
      timeZone: "America/Bogota",
      rows: [{ kind: "day", habitName: "Run", opportunity: { state: "logged" } }],
    });
    expect(JSON.stringify(res.json)).not.toContain("userId");
    expect((await call("GET", "/me/today", "u2")).json.data).toEqual({ state: "noCircle" });
  });

  it("a malformed invite code and a non-uuid habitId are 422 and never reach Postgres (no 22P02)", async () => {
    const { call } = api;
    const circle = await call("POST", "/circles", "u1", createCircleBody("Crew"));
    const season = await call("POST", `/circles/${circle.json.data.id}/seasons`, "u1", {
      timezone: "America/Bogota",
      startDate: TODAY,
      lengthWeeks: 4,
    });
    const join = await call("POST", "/circles/join", "u2", { inviteCode: "0O1IL!" });
    const commitment = await call("POST", `/seasons/${season.json.data.id}/commitments`, "u1", {
      habitId: "not-a-uuid",
      weightPercent: 100,
      privacy: "visible",
      measure: DAILY,
    });
    expect([join.status, commitment.status]).toEqual([422, 422]);
    expect([join.json.error.code, commitment.json.error.code]).toEqual([
      "InvalidRequest",
      "InvalidRequest",
    ]);
  });
});
