import { describe, expect, it } from "vitest";
import { givenSeason } from "./season-fixture.ts";

/**
 * The commitment reminder routes (ADR-0017 addendum, D2): the owner's own setting only. The member
 * is the token's user, so another member's reminder answers 404 like an unknown commitment, and
 * changing it never touches the pact (no new pactRevision, no approvals reset).
 */

const UNKNOWN = "cccccccc-0000-4000-8000-000000000000";
const BODY = { enabled: true, minuteOfDay: 20 * 60, weekdays: [0, 2, 4] };

async function given() {
  const ctx = await givenSeason();
  const reminder = (commitmentId: string) => `${ctx.path}/commitments/${commitmentId}/reminder`;
  return { ...ctx, reminder };
}

describe("GET /seasons/:seasonId/commitments/:commitmentId/reminder", () => {
  it("200 the owner's default: off, 20:00, every day the commitment can fire", async () => {
    const { call, reminder, openCommitmentId } = await given();
    const res = await call("GET", reminder(openCommitmentId), "andrea");
    expect(res).toEqual({
      status: 200,
      json: {
        data: {
          commitmentId: openCommitmentId,
          enabled: false,
          minuteOfDay: 1200,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
        },
      },
    });
  });

  it("SC-R8: 404 CommitmentNotFound for a peer and for an unknown commitment", async () => {
    const { call, reminder, openCommitmentId } = await given();
    const peer = await call("GET", reminder(openCommitmentId), "victor");
    const unknown = await call("GET", reminder(UNKNOWN), "andrea");
    expect([peer, unknown].map((r) => [r.status, r.json.error.code])).toEqual([
      [404, "CommitmentNotFound"],
      [404, "CommitmentNotFound"],
    ]);
  });

  it("401 without a token", async () => {
    const { call, reminder, openCommitmentId } = await given();
    expect((await call("GET", reminder(openCommitmentId), null)).status).toBe(401);
  });
});

describe("PUT /seasons/:seasonId/commitments/:commitmentId/reminder", () => {
  it("200 the saved setting, readable back; a repeat is the same", async () => {
    const { call, reminder, openCommitmentId } = await given();
    const saved = await call("PUT", reminder(openCommitmentId), "andrea", BODY);
    expect(saved.status).toBe(200);
    expect(saved.json.data).toEqual({
      commitmentId: openCommitmentId,
      ...BODY,
      availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect((await call("PUT", reminder(openCommitmentId), "andrea", BODY)).json).toEqual(
      saved.json,
    );
    expect((await call("GET", reminder(openCommitmentId), "andrea")).json).toEqual(saved.json);
  });

  it("SC-R9: leaves the pact untouched (same pactRevision, same version)", async () => {
    const { call, path, reminder, openCommitmentId } = await given();
    const before = await call("GET", path, "andrea");
    await call("PUT", reminder(openCommitmentId), "andrea", BODY);
    const after = await call("GET", path, "andrea");
    expect(after.json.data.pactRevision).toBe(before.json.data.pactRevision);
    expect(after.json.data.version).toBe(before.json.data.version);
  });

  it("422 InvalidReminder with the reason for a time off the grid", async () => {
    const { call, reminder, openCommitmentId } = await given();
    const res = await call("PUT", reminder(openCommitmentId), "andrea", {
      ...BODY,
      minuteOfDay: 22 * 60,
    });
    expect([res.status, res.json.error]).toEqual([
      422,
      { code: "InvalidReminder", message: "InvalidReminder", details: { reason: "time" } },
    ]);
  });

  it("422 InvalidRequest for a body of the wrong shape", async () => {
    const { call, reminder, openCommitmentId } = await given();
    for (const body of [
      { ...BODY, enabled: "yes" },
      { ...BODY, minuteOfDay: 1200.5 },
      { ...BODY, weekdays: [0, 1, 2, 3, 4, 5, 6, 0] },
      { enabled: true, minuteOfDay: 1200 },
    ]) {
      const res = await call("PUT", reminder(openCommitmentId), "andrea", body);
      expect([res.status, res.json.error.code]).toEqual([422, "InvalidRequest"]);
    }
  });

  it("404 for a peer: nobody can set someone else's reminder", async () => {
    const { call, reminder, openCommitmentId } = await given();
    const res = await call("PUT", reminder(openCommitmentId), "victor", BODY);
    expect([res.status, res.json.error.code]).toEqual([404, "CommitmentNotFound"]);
  });
});
