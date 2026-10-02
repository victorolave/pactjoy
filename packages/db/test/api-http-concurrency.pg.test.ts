import { createCircleBody, joinCircleBody } from "@pactjoy/api/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpOverPostgres, DAILY, TODAY, USERS } from "./api-http.ts";
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

/** Bounded repetitions of each race: overlap is timing-dependent, the invariants are not. */
const ITERATIONS = 20;

const statuses = (responses: { status: number }[]) => responses.map((r) => r.status).sort();

/** u1 owns a circle with a pact-open season; returns the ids. */
async function openSeason() {
  const circle = await call("POST", "/circles", "u1", createCircleBody("Crew"));
  const season = await call("POST", `/circles/${circle.json.data.id}/seasons`, "u1", {
    timezone: "America/Bogota",
    startDate: TODAY,
    lengthWeeks: 4,
  });
  return { circleId: circle.json.data.id as string, seasonId: season.json.data.id as string };
}

/**
 * `who` creates a habit and commits 100% of their weight to it. Returns the commitment id and the
 * pact revision the response shows (what an approver would send as `expectedPactRevision`).
 */
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
  return { id: mine.id as string, pactRevision: added.json.data.pactRevision as number };
}

describe("HTTP over Postgres: concurrency", () => {
  it("AC-S10: 30 concurrent requests on a pool of 3 all complete and the pool stays usable", async () => {
    const { seasonId } = await openSeason();
    await commit(seasonId, "u1"); // a participant, so the own-score route resolves a member
    const reads = Array.from({ length: 30 }, (_, i) =>
      call("GET", i % 2 ? `/seasons/${seasonId}/standings` : `/seasons/${seasonId}/score`, "u1"),
    );
    expect(statuses(await Promise.all(reads))).toEqual(Array(30).fill(200));
    expect((await call("GET", `/seasons/${seasonId}/score`, "u1")).status).toBe(200);
  });

  it("UE-C-S10: two joins for the last seat leave one 200 and one refusal, never a 500", async () => {
    const circle = await call("POST", "/circles", "u1", createCircleBody("Crew"));
    const invite = await call("POST", `/circles/${circle.json.data.id}/invite`, "u1");
    for (const joiner of ["u2", "u3", "u4", "u5"]) {
      const joined = await call(
        "POST",
        "/circles/join",
        joiner,
        joinCircleBody(invite.json.data.code, `Joiner ${joiner}`),
      );
      expect(joined.status).toBe(200);
    }
    const race = await Promise.all(
      ["u6", "u7"].map((joiner) =>
        call(
          "POST",
          "/circles/join",
          joiner,
          joinCircleBody(invite.json.data.code, `Joiner ${joiner}`),
        ),
      ),
    );
    expect(statuses(race)).toEqual([200, 409]);
    const refusal = race.find((r) => r.status === 409);
    expect(["CircleFull", "ConcurrencyConflict"]).toContain(refusal?.json.error.code);
  });

  it("UE-S-S11: concurrent season edits never produce a 500, and the stored state matches the 200s", async () => {
    let sawConflict = false;
    for (let i = 0; i < ITERATIONS; i++) {
      await truncateAll(admin);
      const { seasonId } = await openSeason();
      const [before] = await admin`select version from pactjoy.seasons where id = ${seasonId}`;
      const sent = [6, 8];
      const race = await Promise.all(
        sent.map((lengthWeeks) => call("PATCH", `/seasons/${seasonId}`, "u1", { lengthWeeks })),
      );
      expect(race.map((r) => r.status).every((s) => s === 200 || s === 409)).toBe(true);
      for (const lost of race.filter((r) => r.status === 409)) {
        sawConflict = true;
        expect(lost.json.error.code).toBe("ConcurrencyConflict");
      }
      const winners = race.flatMap((r, k) => (r.status === 200 ? [sent[k]] : []));
      expect(winners.length).toBeGreaterThanOrEqual(1);
      const [after] =
        await admin`select length_weeks, version from pactjoy.seasons where id = ${seasonId}`;
      // The stored value is one a 200 acknowledged, and every 200 advanced the version once.
      expect(winners).toContain(after?.length_weeks);
      expect(after?.version).toBe((before?.version as number) + winners.length);
    }
    process.stderr.write(`UE-S-S11: 409 observed in ${ITERATIONS} iterations: ${sawConflict}\n`);
  });

  it("UE-P-S5: members approving at once each get 200 or 409, both approvals are stored and the pact closes", async () => {
    let sawConflict = false;
    for (let i = 0; i < ITERATIONS; i++) {
      await truncateAll(admin);
      const { circleId, seasonId } = await openSeason();
      const invite = await call("POST", `/circles/${circleId}/invite`, "u1");
      await call("POST", "/circles/join", "u2", joinCircleBody(invite.json.data.code));
      await commit(seasonId, "u1");
      // Both approvers read the pact once, after the last commitment landed.
      const { pactRevision } = await commit(seasonId, "u2");
      const approval = { expectedPactRevision: pactRevision };

      const race = await Promise.all(
        ["u1", "u2"].map((who) => call("PUT", `/seasons/${seasonId}/approval`, who, approval)),
      );
      expect(race.map((r) => r.status).every((s) => s === 200 || s === 409)).toBe(true);
      // The only 409 is the optimistic-write conflict: approving never changes the revision, so
      // the precondition itself is never stale here.
      for (const r of race) {
        if (r.status === 409) expect(r.json.error.code).toBe("ConcurrencyConflict");
      }
      // A loser retries with the SAME revision (approval does not change it); it must now succeed.
      const losers = ["u1", "u2"].filter((_, k) => race[k]?.status === 409);
      if (losers.length > 0) sawConflict = true;
      for (const who of losers)
        expect((await call("PUT", `/seasons/${seasonId}/approval`, who, approval)).status).toBe(
          200,
        );
      const [season] = await admin`select status from pactjoy.seasons where id = ${seasonId}`;
      expect(season?.status).toBe("active");
      const [approvals] =
        await admin`select count(distinct member_id)::int as n from pactjoy.season_approvals where season_id = ${seasonId}`;
      expect(approvals?.n).toBe(2);
    }
    process.stderr.write(`UE-P-S5: 409 observed in ${ITERATIONS} iterations: ${sawConflict}\n`);
  });

  describe("one active circle per user (CM-16, CM-17)", () => {
    const ACTIVE_ROWS_FOR_U1 = `select count(*)::int as n from pactjoy.circle_members where user_id = '${USERS[0]}' and status = 'active'`;

    function expectOneWinnerOneConflict(
      race: { status: number; json: { error: { code: string } } }[],
    ): boolean {
      const winners = race.filter((r) => r.status === 201 || r.status === 200);
      const losers = race.filter((r) => r.status === 409);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const code = losers[0]?.json.error.code;
      expect(["AlreadyInActiveCircle", "ConcurrencyConflict"]).toContain(code);
      return code === "ConcurrencyConflict";
    }

    it("CM-16: create and join at once for a user with no circle leave one winner and one 409", async () => {
      let sawConflict = false;
      for (let i = 0; i < ITERATIONS; i++) {
        await truncateAll(admin);
        const other = await call("POST", "/circles", "u2", createCircleBody("Other"));
        const invite = await call("POST", `/circles/${other.json.data.id}/invite`, "u2");
        const race = await Promise.all([
          call("POST", "/circles", "u1", createCircleBody("Mine")),
          call("POST", "/circles/join", "u1", joinCircleBody(invite.json.data.code)),
        ]);
        if (expectOneWinnerOneConflict(race)) sawConflict = true;
        const [row] = await admin.unsafe(ACTIVE_ROWS_FOR_U1);
        expect(row?.n).toBe(1);
      }
      process.stderr.write(
        `CM-16: ConcurrencyConflict observed in ${ITERATIONS}: ${sawConflict}\n`,
      );
    });

    it("CM-17: two creates at once for a user with no circle leave one 201 and one 409", async () => {
      let sawConflict = false;
      for (let i = 0; i < ITERATIONS; i++) {
        await truncateAll(admin);
        const race = await Promise.all([
          call("POST", "/circles", "u1", createCircleBody("First")),
          call("POST", "/circles", "u1", createCircleBody("Second")),
        ]);
        if (expectOneWinnerOneConflict(race)) sawConflict = true;
        const [row] = await admin.unsafe(ACTIVE_ROWS_FOR_U1);
        expect(row?.n).toBe(1);
      }
      process.stderr.write(
        `CM-17: ConcurrencyConflict observed in ${ITERATIONS}: ${sawConflict}\n`,
      );
    });
  });

  it("UE-E-S7: two identical concurrent recordEntry calls store one entry and never fail with 500", async () => {
    const { seasonId } = await openSeason();
    const { id: commitmentId, pactRevision } = await commit(seasonId, "u1");
    const approval = await call("PUT", `/seasons/${seasonId}/approval`, "u1", {
      expectedPactRevision: pactRevision,
    });
    expect(approval.status).toBe(200);
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
