import { describe, expect, it } from "vitest";
import { setup, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

const DONE = { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } };
const REACH = {
  unit: "minutes",
  direction: "reach",
  minimum: "10",
  ideal: "30",
  schedule: { period: "weeklyTotal" },
};
const EDIT = { weightPercent: 50, privacy: "visible", measure: REACH };
const NOWHERE = `/seasons/${UNKNOWN_CIRCLE}/commitments/${UNKNOWN_CIRCLE}`;

async function givenCommitment() {
  const ctx = setup();
  const circle = await ctx.call("POST", "/circles", "andrea", { name: "Crew" });
  const season = await ctx.call("POST", `/circles/${circle.json.data.id}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate: "2023-11-15",
    lengthWeeks: 4,
  });
  const habit = await ctx.call("POST", "/habits", "andrea", { name: "Run" });
  const seasonId: string = season.json.data.id;
  const added = await ctx.call("POST", `/seasons/${seasonId}/commitments`, "andrea", {
    habitId: habit.json.data.id,
    weightPercent: 100,
    privacy: "visible",
    measure: DONE,
  });
  const commitmentId: string = added.json.data.commitments[0].id;
  const path = `/seasons/${seasonId}/commitments/${commitmentId}`;
  return { ...ctx, seasonId, commitmentId, path, habitId: habit.json.data.id as string };
}

/** Adds Victor as an active member of the season's circle (a second member who is not the owner). */
async function joinVictor({ app, seasonId }: Awaited<ReturnType<typeof givenCommitment>>) {
  const season = await app.seasons.get(seasonId as never);
  const circle = await app.circles.get(season?.circleId as never);
  if (!season || !circle) throw new Error("fixture setup failed");
  const joined = { userId: VICTOR, id: "m-victor", status: "active", joinedAt: app.clock.now() };
  await app.circles.save(
    { ...circle, members: [...circle.members, joined as never], version: 9 },
    circle.version,
  );
}

describe("PUT /seasons/:seasonId/commitments/:commitmentId (UE-S-S9)", () => {
  it("200 replaces weight, privacy and measure; the habit stays", async () => {
    const { call, path, habitId } = await givenCommitment();
    const { status, json } = await call("PUT", path, "andrea", EDIT);
    expect(status).toBe(200);
    expect(json.data.commitments).toHaveLength(1);
    expect(json.data.commitments[0]).toMatchObject({ habitId, weightPercent: 50 });
    expect(JSON.stringify(json.data.commitments[0].measure)).toContain('"30"');
    expect(JSON.stringify(json)).not.toContain("aaaaaaaa-0000-4000-8000-000000000001");
  });

  it("passes privacy through: editing to private hides it for everyone (Q2 default)", async () => {
    const { call, path } = await givenCommitment();
    const { json } = await call("PUT", path, "andrea", { ...EDIT, privacy: "private" });
    expect(json.data.commitments[0].kind).toBe("hidden");
  });

  it("maps the app errors: 422 InvalidWeight, 403 NotOwner, 404s, 409 PactNotOpen", async () => {
    const { app, call, path, seasonId } = await givenCommitment();
    const weight = await call("PUT", path, "andrea", { ...EDIT, weightPercent: 7 });
    expect([weight.status, weight.json.error.code]).toEqual([422, "InvalidWeight"]);
    const other = `/seasons/${seasonId}/commitments/${UNKNOWN_CIRCLE}`;
    const unknown = await call("PUT", other, "andrea", EDIT);
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "CommitmentNotFound"]);
    const missing = await call("PUT", NOWHERE, "andrea", EDIT);
    expect([missing.status, missing.json.error.code]).toEqual([404, "SeasonNotFound"]);
    const stranger = await call("PUT", path, "victor", EDIT);
    expect([stranger.status, stranger.json.error.code]).toEqual([403, "NotAMember"]);
    expect(JSON.stringify(stranger.json)).not.toContain(VICTOR);
    const season = await app.seasons.get(seasonId as never);
    if (!season) throw new Error("fixture setup failed");
    await app.seasons.save({ ...season, status: "active", version: 9 }, season.version);
    const closed = await call("PUT", path, "andrea", EDIT);
    expect([closed.status, closed.json.error.code]).toEqual([409, "PactNotOpen"]);
  });

  it("403 NotOwner when another active member edits it", async () => {
    const ctx = await givenCommitment();
    await joinVictor(ctx);
    const { status, json } = await ctx.call("PUT", ctx.path, "victor", EDIT);
    expect([status, json.error.code]).toEqual([403, "NotOwner"]);
  });

  it.each([
    ["malformed commitmentId", "/seasons/nope/commitments/x", EDIT, "seasonId"],
    ["no body", NOWHERE, undefined, ""],
    [
      "habitId in the body (not editable)",
      NOWHERE,
      { ...EDIT, habitId: UNKNOWN_CIRCLE },
      "habitId",
    ],
    ["weightPercent missing", NOWHERE, { privacy: "visible", measure: REACH }, "weightPercent"],
    ["privacy out of the enum", NOWHERE, { ...EDIT, privacy: "public" }, "privacy"],
    [
      "minimum as a number",
      NOWHERE,
      { ...EDIT, measure: { ...REACH, minimum: 5 } },
      "measure.minimum",
    ],
  ])("422 InvalidRequest on %s, no repository call", async (_l, path, body, field) => {
    const { call, transaction, read } = setup();
    const { status, json } = await call("PUT", path, "andrea", body);
    expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(json.error.details.issues[0].path).toBe(field);
    expect(transaction).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("422 on a non-uuid commitmentId", async () => {
    const { call, transaction } = setup();
    const { json } = await call("PUT", `/seasons/${UNKNOWN_CIRCLE}/commitments/x`, "andrea", EDIT);
    expect(json.error.details.issues[0].path).toBe("commitmentId");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("401 without a token", async () => {
    const { call, transaction } = setup();
    const { status, json } = await call("PUT", NOWHERE, null, EDIT);
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("DELETE /seasons/:seasonId/commitments/:commitmentId (UE-S-S10)", () => {
  it("200 returns the season without the commitment", async () => {
    const { call, path } = await givenCommitment();
    const { status, json } = await call("DELETE", path, "andrea");
    expect(status).toBe(200);
    expect(json.data.commitments).toEqual([]);
  });

  it("maps 404 CommitmentNotFound / SeasonNotFound, 403 NotAMember, 409 PactNotOpen", async () => {
    const { app, call, path, seasonId } = await givenCommitment();
    const other = `/seasons/${seasonId}/commitments/${UNKNOWN_CIRCLE}`;
    const unknown = await call("DELETE", other, "andrea");
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "CommitmentNotFound"]);
    const missing = await call("DELETE", NOWHERE, "andrea");
    expect([missing.status, missing.json.error.code]).toEqual([404, "SeasonNotFound"]);
    const stranger = await call("DELETE", path, "victor");
    expect([stranger.status, stranger.json.error.code]).toEqual([403, "NotAMember"]);
    const season = await app.seasons.get(seasonId as never);
    if (!season) throw new Error("fixture setup failed");
    await app.seasons.save({ ...season, status: "active", version: 9 }, season.version);
    const closed = await call("DELETE", path, "andrea");
    expect([closed.status, closed.json.error.code]).toEqual([409, "PactNotOpen"]);
  });

  it("403 NotOwner when another active member removes it, and it stays", async () => {
    const ctx = await givenCommitment();
    await joinVictor(ctx);
    const { status, json } = await ctx.call("DELETE", ctx.path, "victor");
    expect([status, json.error.code]).toEqual([403, "NotOwner"]);
    const season = await ctx.app.seasons.get(ctx.seasonId as never);
    expect(season?.commitments).toHaveLength(1);
  });

  it("422 bodyNotAllowed on a DELETE with any body (the HTTP layer rejects it before the schema)", async () => {
    const { call, path, transaction } = await givenCommitment();
    transaction.mockClear();
    const { status, json } = await call("DELETE", path, "andrea", { x: 1 });
    expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(json.error.details).toEqual({ reason: "bodyNotAllowed" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["seasonId", "/seasons/nope/commitments/x"],
    ["commitmentId", `/seasons/${UNKNOWN_CIRCLE}/commitments/x`],
  ])("422 on a non-uuid %s, no repository call", async (field, path) => {
    const { call, transaction, read } = setup();
    const { status, json } = await call("DELETE", path, "andrea");
    expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(json.error.details.issues[0].path).toBe(
      field === "seasonId" ? "seasonId" : "commitmentId",
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("401 without a token", async () => {
    const { call, transaction } = setup();
    const { status, json } = await call("DELETE", NOWHERE, null);
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
    expect(transaction).not.toHaveBeenCalled();
  });
});
