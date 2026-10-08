import { seasonId } from "@pactjoy/app";
import { describe, expect, it, vi } from "vitest";
import { givenTwoMemberSeason } from "./entries-fixture.ts";
import { UNKNOWN_CIRCLE } from "./harness.ts";

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

/** Andrea logs 30 min with a note today (season day 0). */
async function setup(privacy: "visible" | "private" = "visible") {
  const ctx = await givenTwoMemberSeason(DAILY);
  const season = await ctx.app.seasons.get(seasonId(ctx.seasonId));
  if (!season) throw new Error("missing season");
  await ctx.app.seasons.save(
    { ...season, commitments: season.commitments.map((c) => ({ ...c, privacy })) },
    season.version,
  );
  const logged = await ctx.call("POST", ctx.path, "andrea", {
    commitmentId: ctx.commitmentIds.andrea,
    value: { kind: "quantity", value: "30" },
    note: "Capítulo 3",
    clientRequestId: "req-note",
  });
  expect(logged.status).toBe(201);
  const path = `/seasons/${ctx.seasonId}/commitments/${ctx.commitmentIds.andrea}/progress`;
  return { ...ctx, progressPath: path };
}

describe("GET /seasons/:seasonId/commitments/:commitmentId/progress (A3)", () => {
  it("the owner gets the detail, the engine history with evidence and the scoring curve", async () => {
    const { call, progressPath } = await setup();

    const res = await call("GET", progressPath, "andrea");

    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      state: "active",
      commitment: { kind: "detail", opportunities: { kept: 1, counted: 1 } },
      scoring: {
        opportunityCount: 28,
        curve: [{ value: "5", progressPercent: "0" }, {}, {}, {}, {}],
      },
    });
    const [cell] = res.json.data.weeks[0].cells;
    expect(cell).toMatchObject({
      kind: "day",
      status: "ideal",
      late: false,
      evidence: [{ value: { kind: "quantity", value: "30" }, note: "Capítulo 3" }],
    });
    const body = JSON.stringify(res.json);
    for (const secret of ["req-note", "clientRequestId", "entryId", "userId"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("a peer reads a visible commitment", async () => {
    const { call, progressPath } = await setup();

    const res = await call("GET", progressPath, "victor");
    expect(res.status).toBe(200);
    expect(res.json.data.weeks[0].cells[0].evidence[0].note).toBe("Capítulo 3");
  });

  it("a peer's private commitment is 404 before any habit is read", async () => {
    const { app, call, progressPath } = await setup("private");
    const habits = vi.spyOn(app.habits, "getMany");

    const res = await call("GET", progressPath, "victor");

    expect([res.status, res.json.error.code]).toEqual([404, "CommitmentNotFound"]);
    expect(JSON.stringify(res.json)).not.toContain("Capítulo 3");
    expect(habits).not.toHaveBeenCalled();
  });

  it("rejects no token, a malformed id and an unknown commitment", async () => {
    const { call, seasonId: season, progressPath } = await setup();

    expect((await call("GET", progressPath, null)).status).toBe(401);
    // A malformed id fails the request validation (422) before any read.
    expect(
      (await call("GET", `/seasons/${season}/commitments/nope/progress`, "andrea")).status,
    ).toBe(422);
    const unknown = await call(
      "GET",
      `/seasons/${season}/commitments/${UNKNOWN_CIRCLE}/progress`,
      "andrea",
    );
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "CommitmentNotFound"]);
  });
});
