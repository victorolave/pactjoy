import { createCircleBody, joinCircleBody } from "@pactjoy/api/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpOverPostgres, DAILY, TODAY } from "./api-http.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

// Smoke over real Postgres for the social routes (ADR-0011 Q25). The reaction route derives the
// feed INSIDE its write transaction (ADR-0018 design risk), so the call is timed and the observed
// duration is logged for the apply notes; the bound below is generous, only a runaway fails.
const api = createHttpOverPostgres();
const admin = connect(databaseUrl());
beforeEach(() => truncateAll(admin));
afterAll(async () => {
  await truncateAll(admin);
  await api.end();
  await admin.end();
});

describe("HTTP over Postgres: the social routes", () => {
  it("SO-PG1: the feed and a reaction (set, change, remove) on the migrated database", async () => {
    const { call } = api;
    const circle = await call("POST", "/circles", "u1", createCircleBody("Crew", "Ana"));
    const circleId: string = circle.json.data.id;
    const invite = await call("POST", `/circles/${circleId}/invite`, "u1");
    await call("POST", "/circles/join", "u2", joinCircleBody(invite.json.data.code, "Beto"));
    const season = await call("POST", `/circles/${circleId}/seasons`, "u1", {
      timezone: "America/Bogota",
      startDate: TODAY,
      lengthWeeks: 4,
    });
    const seasonId: string = season.json.data.id;
    const commitmentIds: Record<string, string> = {};
    let pactRevision = 0;
    for (const who of ["u1", "u2"]) {
      const habit = await call("POST", "/habits", who, { name: `Run ${who}` });
      const added = await call("POST", `/seasons/${seasonId}/commitments`, who, {
        habitId: habit.json.data.id,
        weightPercent: 100,
        privacy: "visible",
        measure: DAILY,
      });
      commitmentIds[who] = added.json.data.commitments.find(
        (c: { habitId?: string }) => c.habitId === habit.json.data.id,
      ).id;
      pactRevision = added.json.data.pactRevision;
    }
    for (const who of ["u1", "u2"]) {
      await call("PUT", `/seasons/${seasonId}/approval`, who, {
        expectedPactRevision: pactRevision,
      });
    }
    const recorded = await call("POST", `/seasons/${seasonId}/entries`, "u1", {
      commitmentId: commitmentIds.u1,
      value: { kind: "quantity", value: "30" },
      clientRequestId: "r-1",
    });
    expect(recorded.status).toBe(201);

    const feed = await call("GET", "/me/feed", "u2");
    expect(feed.status).toBe(200);
    expect(feed.json.data.seasonId).toBe(seasonId);
    const key = `session:${commitmentIds.u1}:1`;
    const item = feed.json.data.items.find((i: { key: string }) => i.key === key);
    expect(item).toMatchObject({
      kind: "completed",
      subject: { kind: "habit", name: "Run u1" },
      value: { amount: "30", unit: "minutes" },
    });

    const path = `/seasons/${seasonId}/feed/${encodeURIComponent(key)}/reaction`;
    const started = performance.now();
    const put = await call("PUT", path, "u2", { emoji: "fire" });
    const elapsed = performance.now() - started;
    console.info(`[SO-PG1] PUT reaction over Postgres: ${elapsed.toFixed(1)} ms`);
    expect([put.status, put.json.data]).toEqual([
      200,
      { counts: { heart: 0, raisedHands: 0, fire: 1, clap: 0 }, mine: "fire", reactable: true },
    ]);
    expect(elapsed).toBeLessThan(2000);
    const stored = await admin`select emoji from pactjoy.feed_reactions`;
    expect(stored.map((r) => r.emoji)).toEqual(["fire"]);

    const change = await call("PUT", path, "u2", { emoji: "clap" });
    expect(change.json.data.counts).toEqual({ heart: 0, raisedHands: 0, fire: 0, clap: 1 });
    const owner = await call("GET", "/me/feed", "u1");
    expect(owner.json.data.items.find((i: { key: string }) => i.key === key).reactions).toEqual({
      counts: { heart: 0, raisedHands: 0, fire: 0, clap: 1 },
      mine: null,
      reactable: false,
    });

    const del = await call("DELETE", path, "u2");
    expect(del.json.data.mine).toBeNull();
    const [row] = await admin`select count(*)::int as n from pactjoy.feed_reactions`;
    expect(row?.n).toBe(0);
  });
});
