import { describe, expect, it } from "vitest";
import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";
import { setup } from "./harness.ts";

// Every weekday scheduled (0-6): today already counts, so a logged day scores immediately.
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

describe("AC-S3: the whole journey over in-memory adapters", () => {
  it("circle, invite, join, season, commitments, pact, entries, ranked standings", async () => {
    const { call } = setup();
    const circle = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    expect(circle.status).toBe(201);
    const circleId: string = circle.json.data.id;
    const invite = await call("POST", `/circles/${circleId}/invite`, "andrea");
    const joined = await call(
      "POST",
      "/circles/join",
      "victor",
      joinCircleBody(invite.json.data.code),
    );
    expect(joined.status).toBe(200);
    const season = await call("POST", `/circles/${circleId}/seasons`, "andrea", {
      timezone: "America/Bogota",
      startDate: "2023-11-14",
      lengthWeeks: 4,
    });
    const seasonId: string = season.json.data.id;
    const commitmentIds: Record<string, string> = {};
    let pactRevision = 0;
    for (const who of ["andrea", "victor"]) {
      const habit = await call("POST", "/habits", who, { name: `Run ${who}` });
      const added = await call("POST", `/seasons/${seasonId}/commitments`, who, {
        habitId: habit.json.data.id,
        weightPercent: 100,
        privacy: "visible",
        measure: DAILY,
      });
      expect(added.status).toBe(201);
      commitmentIds[who] = added.json.data.commitments.find(
        (c: { habitId?: string }) => c.habitId === habit.json.data.id,
      ).id;
      pactRevision = added.json.data.pactRevision;
    }
    for (const who of ["andrea", "victor"]) {
      const approved = await call("PUT", `/seasons/${seasonId}/approval`, who, {
        expectedPactRevision: pactRevision,
      });
      expect(approved.status).toBe(200);
    }

    const entries = `/seasons/${seasonId}/entries`;
    const full = await call("POST", entries, "victor", {
      commitmentId: commitmentIds.victor,
      value: { kind: "quantity", value: "30" },
      clientRequestId: "v-1",
    });
    const half = await call("POST", entries, "andrea", {
      commitmentId: commitmentIds.andrea,
      value: { kind: "quantity", value: "15" },
      clientRequestId: "a-1",
    });
    expect([full.status, half.status]).toEqual([201, 201]);

    const standings = await call("GET", `/seasons/${seasonId}/standings`, "andrea");
    const { rows, eligibleParticipantCount } = standings.json.data;
    expect(standings.json.data.kind).toBe("ranked");
    expect(eligibleParticipantCount).toBe(2);
    expect(rows.map((r: { memberId: string }) => r.memberId)).toEqual([
      full.json.data.entry.memberId,
      half.json.data.entry.memberId,
    ]);
    expect(rows.map((r: { rank: number }) => r.rank)).toEqual([1, 2]);
    expect(rows[0].points).toBeGreaterThan(rows[1].points);

    // The same ranking is visible from the other member, and each reads only their own totals.
    const mine = await call("GET", `/seasons/${seasonId}/score`, "andrea");
    expect(mine.json.data.scope).toBe("own");
    expect(mine.json.data.points).toBe(rows[1].points);
    const theirs = await call(
      "GET",
      `/seasons/${seasonId}/members/${full.json.data.entry.memberId}/score`,
      "andrea",
    );
    expect(theirs.json.data.scope).toBe("others");
    expect(theirs.json.data.points).toBe(rows[0].points);
  });
});
