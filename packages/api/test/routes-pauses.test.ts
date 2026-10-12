import { describe, expect, it } from "vitest";
import { givenTwoMemberSeason } from "./entries-fixture.ts";
import { ANDREA, VICTOR } from "./harness.ts";

// The clock sits on 2023-11-14 (America/Bogota), season day 0, a 4-week season (cap 14).
const UNKNOWN = "cccccccc-0000-4000-8000-000000000000";

async function given(privacy: { andrea?: "visible" | "private" } = {}) {
  const ctx = await givenTwoMemberSeason(undefined, privacy);
  const create = (body: Record<string, unknown> = {}, who = "andrea") =>
    ctx.call("POST", `/seasons/${ctx.seasonId}/pause-requests`, who, {
      scope: { kind: "commitment", commitmentId: ctx.commitmentIds.andrea },
      reason: "health",
      note: "Flu",
      startDate: "2023-11-15",
      endDate: "2023-11-17",
      ...body,
    });
  return { ...ctx, create };
}

describe("401 on every pause route (PA-S4)", () => {
  it("rejects a missing token on all five", async () => {
    const { call, seasonId } = await given();
    const results = await Promise.all([
      call("POST", `/seasons/${seasonId}/pause-requests`, null, {}),
      call("GET", "/me/pause-requests", null),
      call("PUT", `/pause-requests/${UNKNOWN}/response`, null, { decision: "approve" }),
      call("DELETE", `/pause-requests/${UNKNOWN}`, null),
      call("POST", `/pause-requests/${UNKNOWN}/resume`, null, {}),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
  });
});

describe("POST /seasons/:seasonId/pause-requests", () => {
  it("201 with the requester's projection and no user ids", async () => {
    const { create, commitmentIds } = await given();

    const res = await create();

    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({
      status: "pending",
      reason: "health",
      note: "Flu",
      startDate: "2023-11-15",
      endDate: "2023-11-17",
      decidedAt: null,
      commitments: [
        { commitmentId: commitmentIds.andrea, habitName: "Run andrea", resumedOn: null },
      ],
      approvers: [{ displayName: "Joiner", response: null }],
    });
    expect(Object.keys(res.json.data).sort()).toEqual([
      "approvers",
      "autoApproveAt",
      "commitments",
      "decidedAt",
      "endDate",
      "id",
      "note",
      "reason",
      "requestedAt",
      "startDate",
      "status",
    ]);
    expect(JSON.stringify(res.json)).not.toContain(ANDREA);
    expect(JSON.stringify(res.json)).not.toContain(VICTOR);
    expect(res.json.data.autoApproveAt).toBe("2023-11-16T22:13:20.000Z");
  });

  it("scope all and an open end are accepted", async () => {
    const { create } = await given();
    const res = await create({ scope: { kind: "all" }, endDate: null });
    expect(res.status).toBe(201);
    expect(res.json.data.endDate).toBeNull();
  });

  it("422 for a body that is not the documented shape", async () => {
    const { create } = await given();
    const unknownScope = await create({ scope: { kind: "everyone" } });
    const missingReason = await create({ reason: undefined });
    const extra = await create({ memberId: "x" });
    const badDate = await create({ startDate: "tomorrow" });
    expect(
      [unknownScope, missingReason, extra, badDate].map((r) => [r.status, r.json.error.code]),
    ).toEqual([
      [422, "InvalidRequest"],
      [422, "InvalidRequest"],
      [422, "InvalidRequest"],
      [422, "InvalidRequest"],
    ]);
  });

  it("the app's domain errors use the design's statuses", async () => {
    const { create, call, seasonId, commitmentIds } = await given();
    const reason = await create({ reason: "holiday" });
    const retro = await create({ startDate: "2023-11-13" });
    const order = await create({ startDate: "2023-11-17", endDate: "2023-11-16" });
    const after = await create({ startDate: "2023-12-10", endDate: "2023-12-12" });
    const notMine = await call("POST", `/seasons/${seasonId}/pause-requests`, "andrea", {
      scope: { kind: "commitment", commitmentId: commitmentIds.victor },
      reason: "work",
      note: null,
      startDate: "2023-11-15",
      endDate: null,
    });
    expect(
      [reason, retro, order, after, notMine].map((r) => [r.status, r.json.error.code]),
    ).toEqual([
      [422, "InvalidPauseReason"],
      [422, "PauseRetroactive"],
      [422, "PauseEndBeforeStart"],
      [422, "PauseEndsAfterSeason"],
      [403, "CommitmentNotOwned"],
    ]);
  });

  it("409 PauseOverlaps and PauseCapExceeded (PA-S1) with their details", async () => {
    const { create, commitmentIds } = await given();
    await create({ startDate: "2023-11-15", endDate: "2023-11-17" });

    const overlap = await create({ startDate: "2023-11-17", endDate: "2023-11-18" });
    const cap = await create({ startDate: "2023-11-20", endDate: "2023-12-05" });

    expect([overlap.status, overlap.json.error]).toEqual([
      409,
      {
        code: "PauseOverlaps",
        message: "PauseOverlaps",
        details: { commitmentIds: [commitmentIds.andrea] },
      },
    ]);
    expect([cap.status, cap.json.error]).toEqual([
      409,
      {
        code: "PauseCapExceeded",
        message: "PauseCapExceeded",
        details: {
          commitments: [
            {
              commitmentId: commitmentIds.andrea,
              reason: "exceedsRemainingCap",
              remainingDays: 11,
            },
          ],
        },
      },
    ]);
  });

  it("404 for a season that does not exist", async () => {
    const { call } = await given();
    const res = await call("POST", `/seasons/${UNKNOWN}/pause-requests`, "andrea", {
      scope: { kind: "all" },
      reason: "work",
      note: null,
      startDate: "2023-11-15",
      endDate: null,
    });
    expect([res.status, res.json.error.code]).toEqual([404, "SeasonNotFound"]);
  });
});

describe("GET /me/pause-requests", () => {
  it("is total: a user with no circle gets empty lists", async () => {
    const { setup } = await import("./harness.ts");
    const { call } = setup();
    const res = await call("GET", "/me/pause-requests", "andrea");
    expect(res.json.data).toEqual({
      seasonId: null,
      mine: [],
      awaitingMe: [],
      budgets: [],
      redistributed: null,
    });
  });

  it("the requester sees hers with the budget; the approver sees it awaiting, with the note", async () => {
    const { create, call, seasonId, commitmentIds } = await given();
    const created = await create();

    const mine = await call("GET", "/me/pause-requests", "andrea");
    const theirs = await call("GET", "/me/pause-requests", "victor");

    expect(mine.status).toBe(200);
    expect(mine.json.data.seasonId).toBe(seasonId);
    expect(mine.json.data.mine.map((r: { id: string }) => r.id)).toEqual([created.json.data.id]);
    expect(mine.json.data.awaitingMe).toEqual([]);
    expect(mine.json.data.budgets).toEqual([
      { commitmentId: commitmentIds.andrea, cap: 14, usedDays: 3, remainingDays: 11 },
    ]);
    expect(theirs.json.data.mine).toEqual([]);
    expect(theirs.json.data.awaitingMe).toEqual([
      {
        id: created.json.data.id,
        status: "pending",
        reason: "health",
        note: "Flu",
        startDate: "2023-11-15",
        endDate: "2023-11-17",
        requestedAt: created.json.data.requestedAt,
        autoApproveAt: created.json.data.autoApproveAt,
        requester: { memberId: expect.any(String), displayName: "Creator" },
        myResponse: null,
        commitments: [
          {
            kind: "visible",
            commitmentId: commitmentIds.andrea,
            habitName: "Run andrea",
            icon: null,
          },
        ],
      },
    ]);
    expect(JSON.stringify(theirs.json)).not.toContain(ANDREA);
  });

  it("a private Commitment reaches the approver as exactly {kind: hidden, commitmentId} (PA-S2)", async () => {
    const { create, call, commitmentIds } = await given({ andrea: "private" });
    await create();

    const res = await call("GET", "/me/pause-requests", "victor");

    expect(res.json.data.awaitingMe[0].commitments).toEqual([
      { kind: "hidden", commitmentId: commitmentIds.andrea },
    ]);
    expect(JSON.stringify(res.json)).not.toContain("Run andrea");
  });

  it("shows the effective status with no prior write (PA-8)", async () => {
    const { create, call, setNow } = await given();
    await create();
    setNow(new Date("2023-11-17T00:00:00Z").getTime() as never);

    const res = await call("GET", "/me/pause-requests", "andrea");

    expect(res.json.data.mine[0]).toMatchObject({ status: "approved" });
  });
});

describe("PUT /pause-requests/:pauseRequestId/response", () => {
  it("200 with the approver's projection; the single approver decides at once", async () => {
    const { create, call } = await given();
    const created = await create();

    const res = await call("PUT", `/pause-requests/${created.json.data.id}/response`, "victor", {
      decision: "approve",
    });

    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      id: created.json.data.id,
      status: "approved",
      myResponse: "approve",
      requester: { displayName: "Creator" },
    });
  });

  it("once decided the answer is final (Q3)", async () => {
    const { create, call } = await given();
    const created = await create();
    const url = `/pause-requests/${created.json.data.id}/response`;

    const first = await call("PUT", url, "victor", { decision: "reject" });
    const again = await call("PUT", url, "victor", { decision: "reject" });
    const flip = await call("PUT", url, "victor", { decision: "approve" });

    expect([first.status, again.status]).toEqual([200, 409]);
    expect(first.json.data.status).toBe("rejected");
    expect([flip.status, flip.json.error.code]).toEqual([409, "PauseAlreadyDecided"]);
  });

  it("403 for the requester's own request, 404 for an unknown or foreign id", async () => {
    const { create, call } = await given();
    const created = await create();

    const own = await call("PUT", `/pause-requests/${created.json.data.id}/response`, "andrea", {
      decision: "approve",
    });
    const unknown = await call("PUT", `/pause-requests/${UNKNOWN}/response`, "victor", {
      decision: "approve",
    });

    expect([own.status, own.json.error.code]).toEqual([403, "CannotRespondToOwnPause"]);
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "PauseRequestNotFound"]);
  });

  it("422 for a body with expectedVersion (D2) or a bad decision or a bad id", async () => {
    const { create, call } = await given();
    const created = await create();
    const url = `/pause-requests/${created.json.data.id}/response`;
    const versioned = await call("PUT", url, "victor", { decision: "approve", expectedVersion: 0 });
    const bad = await call("PUT", url, "victor", { decision: "maybe" });
    const id = await call("PUT", "/pause-requests/not-a-uuid/response", "victor", {
      decision: "approve",
    });
    expect([versioned, bad, id].map((r) => r.status)).toEqual([422, 422, 422]);
  });
});

describe("DELETE /pause-requests/:pauseRequestId", () => {
  it("cancels a pending request; a second cancel is PauseAlreadyDecided", async () => {
    const { create, call } = await given();
    const created = await create();
    const url = `/pause-requests/${created.json.data.id}`;

    const cancelled = await call("DELETE", url, "andrea");
    const again = await call("DELETE", url, "andrea");

    expect(cancelled.status).toBe(200);
    expect(cancelled.json.data).toMatchObject({ status: "cancelled" });
    expect(cancelled.json.data.decidedAt).not.toBeNull();
    expect([again.status, again.json.error.code]).toEqual([409, "PauseAlreadyDecided"]);
  });

  it("403 for someone else, 404 for an unknown id", async () => {
    const { create, call } = await given();
    const created = await create();
    const other = await call("DELETE", `/pause-requests/${created.json.data.id}`, "victor");
    const unknown = await call("DELETE", `/pause-requests/${UNKNOWN}`, "andrea");
    expect([other.status, other.json.error.code]).toEqual([403, "NotPauseRequester"]);
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "PauseRequestNotFound"]);
  });
});

describe("POST /pause-requests/:pauseRequestId/resume", () => {
  async function approved() {
    const ctx = await given();
    const created = await ctx.create({ scope: { kind: "all" }, startDate: "2023-11-14" });
    await ctx.call("PUT", `/pause-requests/${created.json.data.id}/response`, "victor", {
      decision: "approve",
    });
    return { ...ctx, id: created.json.data.id as string };
  }

  it("a pending request is PauseNotPending", async () => {
    const { create, call } = await given();
    const created = await create();
    const res = await call("POST", `/pause-requests/${created.json.data.id}/resume`, "andrea", {});
    expect([res.status, res.json.error.code]).toEqual([409, "PauseNotPending"]);
  });

  it("resumes today with an empty body or a commitmentId, then PauseNotActive", async () => {
    const { call, id, commitmentIds } = await approved();

    const resumed = await call("POST", `/pause-requests/${id}/resume`, "andrea", {
      commitmentId: commitmentIds.andrea,
    });
    const again = await call("POST", `/pause-requests/${id}/resume`, "andrea");

    expect(resumed.status).toBe(200);
    expect(resumed.json.data.status).toBe("approved");
    expect(resumed.json.data.commitments[0].resumedOn).toBe("2023-11-14");
    expect([again.status, again.json.error.code]).toEqual([409, "PauseNotActive"]);
  });

  it("422 for a body that is not a commitmentId; 403 for a Commitment not in the request", async () => {
    const { call, id, commitmentIds } = await approved();
    const bad = await call("POST", `/pause-requests/${id}/resume`, "andrea", { commitmentId: 3 });
    const foreign = await call("POST", `/pause-requests/${id}/resume`, "andrea", {
      commitmentId: commitmentIds.victor,
    });
    const other = await call("POST", `/pause-requests/${id}/resume`, "victor", {});
    expect(bad.status).toBe(422);
    expect([foreign.status, foreign.json.error.code]).toEqual([403, "CommitmentNotOwned"]);
    expect([other.status, other.json.error.code]).toEqual([403, "NotPauseRequester"]);
  });
});

describe("GET /me/today carries the nested pause (PA-9)", () => {
  it("null without a request, then the pending request with canCancel", async () => {
    const { create, call, commitmentIds } = await given();
    const before = await call("GET", "/me/today", "andrea");
    expect(before.json.data.rows[0].pause).toBeNull();

    const created = await create({ startDate: "2023-11-14", endDate: "2023-11-16" });
    const after = await call("GET", "/me/today", "andrea");

    expect(after.json.data.rows[0].commitmentId).toBe(commitmentIds.andrea);
    expect(after.json.data.rows[0].pause).toEqual({
      pauseRequestId: created.json.data.id,
      status: "pending",
      reason: "health",
      endDate: "2023-11-16",
      endsTomorrow: false,
      canResume: false,
      canCancel: true,
    });
  });
});
