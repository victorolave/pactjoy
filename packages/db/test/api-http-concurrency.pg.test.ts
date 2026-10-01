import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpOverPostgres, DAILY, TODAY } from "./api-http.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

// Pool of 3 (the production setting): every race below also runs under connection pressure.
const api = createHttpOverPostgres(3);
const { call } = api;
const admin = connect(databaseUrl());
beforeEach(() => truncateAll(admin));
afterAll(async () => {
  await truncateAll(admin); // leave the shared database clean for the next file
  await api.end();
  await admin.end();
});

const statuses = (responses: { status: number }[]) => responses.map((r) => r.status).sort();

/** u1 owns a circle with a pact-open season; returns the ids. */
async function openSeason() {
  const circle = await call("POST", "/circles", "u1", { name: "Crew" });
  const season = await call("POST", `/circles/${circle.json.data.id}/seasons`, "u1", {
    timezone: "America/Bogota",
    startDate: TODAY,
    lengthWeeks: 4,
  });
  return { circleId: circle.json.data.id as string, seasonId: season.json.data.id as string };
}

/** `who` creates a habit and commits 100% of their weight to it. Returns the commitment id. */
async function commit(seasonId: string, who: string) {
  const habit = await call("POST", "/habits", who, { name: `Run ${who}` });
  const added = await call("POST", `/seasons/${seasonId}/commitments`, who, {
    habitId: habit.json.data.id,
    weightPercent: 100,
    privacy: "visible",
    measure: DAILY,
  });
  expect(added.status).toBe(201);
  const mine = added.json.data.commitments.find(
    (c: { habitId?: string }) => c.habitId === habit.json.data.id,
  );
  return mine.id as string;
}

describe("HTTP over Postgres: concurrency", () => {
  it("AC-S10: 10 concurrent requests on a pool of 3 all complete", async () => {
    const { seasonId } = await openSeason();
    await commit(seasonId, "u1"); // a participant, so the own-score route resolves a member
    const reads = Array.from({ length: 10 }, (_, i) =>
      call("GET", i % 2 ? `/seasons/${seasonId}/standings` : `/seasons/${seasonId}/score`, "u1"),
    );
    expect(statuses(await Promise.all(reads))).toEqual(Array(10).fill(200));
  });

  it("UE-C-S10: two joins for the last seat leave one 200 and one refusal, never a 500", async () => {
    const circle = await call("POST", "/circles", "u1", { name: "Crew" });
    const invite = await call("POST", `/circles/${circle.json.data.id}/invite`, "u1");
    for (const joiner of ["u2", "u3", "u4", "u5"]) {
      const joined = await call("POST", "/circles/join", joiner, {
        inviteCode: invite.json.data.code,
      });
      expect(joined.status).toBe(200);
    }
    const race = await Promise.all(
      ["u6", "u7"].map((joiner) =>
        call("POST", "/circles/join", joiner, { inviteCode: invite.json.data.code }),
      ),
    );
    expect(statuses(race)).toEqual([200, 409]);
    const refusal = race.find((r) => r.status === 409);
    expect(["CircleFull", "ConcurrencyConflict"]).toContain(refusal?.json.error.code);
  });

  it("UE-S-S11: two concurrent season edits never produce a 500", async () => {
    const { seasonId } = await openSeason();
    const race = await Promise.all(
      [6, 8].map((lengthWeeks) => call("PATCH", `/seasons/${seasonId}`, "u1", { lengthWeeks })),
    );
    expect(race.map((r) => r.status).every((s) => s === 200 || s === 409)).toBe(true);
    expect(race.some((r) => r.status === 200)).toBe(true);
    for (const lost of race.filter((r) => r.status === 409))
      expect(lost.json.error.code).toBe("ConcurrencyConflict");
  });

  it("UE-P-S5: two members approving at once each get 200 or 409, and a retry closes the pact", async () => {
    const { circleId, seasonId } = await openSeason();
    const invite = await call("POST", `/circles/${circleId}/invite`, "u1");
    await call("POST", "/circles/join", "u2", { inviteCode: invite.json.data.code });
    await commit(seasonId, "u1");
    await commit(seasonId, "u2");

    const race = await Promise.all(
      ["u1", "u2"].map((who) => call("PUT", `/seasons/${seasonId}/approval`, who)),
    );
    expect(race.map((r) => r.status).every((s) => s === 200 || s === 409)).toBe(true);
    // A loser retries (its 409 is the signal to do so); it must now succeed.
    const losers = ["u1", "u2"].filter((_, i) => race[i]?.status === 409);
    for (const who of losers)
      expect((await call("PUT", `/seasons/${seasonId}/approval`, who)).status).toBe(200);
    const [season] = await admin`select status from pactjoy.seasons where id = ${seasonId}`;
    expect(season?.status).toBe("active");
  });

  it("UE-E-S7: two identical concurrent recordEntry calls store one entry and never fail with 500", async () => {
    const { seasonId } = await openSeason();
    const commitmentId = await commit(seasonId, "u1");
    expect((await call("PUT", `/seasons/${seasonId}/approval`, "u1")).status).toBe(200);
    const entry = {
      commitmentId,
      value: { kind: "quantity", value: "30" },
      clientRequestId: "race-1",
    };
    const race = await Promise.all([
      call("POST", `/seasons/${seasonId}/entries`, "u1", entry),
      call("POST", `/seasons/${seasonId}/entries`, "u1", entry),
    ]);
    const [first, second] = statuses(race);
    expect(first).toBe(201);
    expect([200, 409]).toContain(second);
    const [row] = await admin`select count(*)::int as n from pactjoy.entries`;
    expect(row?.n).toBe(1);
  });
});
