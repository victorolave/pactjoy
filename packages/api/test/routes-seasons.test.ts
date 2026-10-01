import { seasonId } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { setup, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

// The fixed test clock is 2023-11-14T22:13Z, so in America/Bogota "tomorrow" is 2023-11-15.
const VALID = { timezone: "America/Bogota", startDate: "2023-11-15", lengthWeeks: 4 };
const NOWHERE = `/circles/${UNKNOWN_CIRCLE}/seasons`;

async function givenCircle() {
  const ctx = setup();
  const created = await ctx.call("POST", "/circles", "andrea", { name: "Crew" });
  const circleId: string = created.json.data.id;
  return { ...ctx, circleId, seasonsPath: `/circles/${circleId}/seasons` };
}

async function givenSeason() {
  const ctx = await givenCircle();
  const created = await ctx.call("POST", ctx.seasonsPath, "andrea", VALID);
  return { ...ctx, id: created.json.data.id as string };
}

describe("POST /circles/:circleId/seasons (UE-S-S1..S3)", () => {
  it("S1: 201 pactOpen, the app defaults reviewCadenceWeeks; no userId leaks", async () => {
    const { call, seasonsPath, circleId } = await givenCircle();
    const { status, json } = await call("POST", seasonsPath, "andrea", VALID);
    expect(status).toBe(201);
    expect(json.data).toMatchObject({
      circleId,
      status: "pactOpen",
      lengthWeeks: 4,
      timeZone: "America/Bogota",
      commitments: [],
    });
    expect(json.data.reviewCadenceWeeks).toBeGreaterThan(0);
    expect(JSON.stringify(json)).not.toContain("aaaaaaaa-0000-4000-8000-000000000001");
  });

  it("an explicit reviewCadenceWeeks is passed through", async () => {
    const { call, seasonsPath } = await givenCircle();
    const { json } = await call("POST", seasonsPath, "andrea", { ...VALID, reviewCadenceWeeks: 2 });
    expect(json.data.reviewCadenceWeeks).toBe(2);
  });

  it.each([
    ["InvalidTimezone", { ...VALID, timezone: "Nowhere/Land" }],
    ["StartDateInPast", { ...VALID, startDate: "2023-11-01" }],
    ["StartDateTooFarAhead", { ...VALID, startDate: "2024-03-01" }],
    ["InvalidLengthWeeks", { ...VALID, lengthWeeks: 5 }],
    ["InvalidReviewCadenceWeeks", { ...VALID, reviewCadenceWeeks: 4 }],
    ["InvalidStartDate", { ...VALID, startDate: "nope" }],
  ])(
    "S2/RV-S25/RV-S28: the app answers 422 %s (not duplicated at the boundary)",
    async (kind, body) => {
      const { call, seasonsPath } = await givenCircle();
      const { status, json } = await call("POST", seasonsPath, "andrea", body);
      expect([status, json.error.code]).toEqual([422, kind]);
    },
  );

  it("S3: 409 SeasonInProgress, 403 NotAMember, 404 CircleNotFound, 409 CircleArchived", async () => {
    const { app, call, seasonsPath, circleId } = await givenSeason();
    const again = await call("POST", seasonsPath, "andrea", VALID);
    expect([again.status, again.json.error.code]).toEqual([409, "SeasonInProgress"]);
    const stranger = await call("POST", seasonsPath, "victor", VALID);
    expect([stranger.status, stranger.json.error.code]).toEqual([403, "NotAMember"]);
    const missing = await call("POST", NOWHERE, "andrea", VALID);
    expect([missing.status, missing.json.error.code]).toEqual([404, "CircleNotFound"]);
    const circle = await app.circles.get(circleId as never);
    if (!circle) throw new Error("fixture setup failed");
    await app.circles.save({ ...circle, archivedAt: app.clock.now(), version: 9 }, circle.version);
    const archived = await call("POST", seasonsPath, "andrea", VALID);
    expect([archived.status, archived.json.error.code]).toEqual([409, "CircleArchived"]);
  });

  it.each([
    ["malformed circleId", "/circles/not-a-uuid/seasons", VALID, "circleId"],
    ["timezone missing", NOWHERE, { startDate: "2023-11-15", lengthWeeks: 4 }, "timezone"],
    ["lengthWeeks as string", NOWHERE, { ...VALID, lengthWeeks: "4" }, "lengthWeeks"],
    ["unknown field", NOWHERE, { ...VALID, status: "active" }, "status"],
    ["no body", NOWHERE, undefined, ""],
  ])("422 InvalidRequest on %s, no repository call", async (_l, path, body, field) => {
    const { call, transaction, read } = setup();
    const { status, json } = await call("POST", path, "andrea", body);
    expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(json.error.details.issues[0].path).toBe(field);
    expect(transaction).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("401 without a token", async () => {
    const { call, transaction } = setup();
    const { status, json } = await call("POST", NOWHERE, null, VALID);
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("PATCH /seasons/:seasonId (UE-S-S4)", () => {
  it("200 edits only the sent fields and resets approvals (visible in the DTO)", async () => {
    const { app, call, id } = await givenSeason();
    const season = await app.seasons.get(seasonId(id));
    const member = (await app.circles.get(season?.circleId as never))?.members[0];
    if (!season || !member) throw new Error("fixture setup failed");
    await app.seasons.save(
      { ...season, approvals: [{ memberId: member.id, approvedAt: app.clock.now() }], version: 9 },
      season.version,
    );
    const { status, json } = await call("PATCH", `/seasons/${id}`, "andrea", { lengthWeeks: 8 });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({
      id,
      lengthWeeks: 8,
      timeZone: "America/Bogota",
      approvals: [],
    });
  });

  it("409 PactNotOpen once the pact is closed", async () => {
    const { app, call, id } = await givenSeason();
    const season = await app.seasons.get(seasonId(id));
    if (!season) throw new Error("fixture setup failed");
    await app.seasons.save({ ...season, status: "active", version: 9 }, season.version);
    const { status, json } = await call("PATCH", `/seasons/${id}`, "andrea", { lengthWeeks: 8 });
    expect([status, json.error.code]).toEqual([409, "PactNotOpen"]);
  });

  it("404 SeasonNotFound, 403 NotAMember, and app 422 InvalidLengthWeeks", async () => {
    const { call, id } = await givenSeason();
    const missing = await call("PATCH", `/seasons/${UNKNOWN_CIRCLE}`, "andrea", {});
    expect([missing.status, missing.json.error.code]).toEqual([404, "SeasonNotFound"]);
    const stranger = await call("PATCH", `/seasons/${id}`, "victor", { lengthWeeks: 8 });
    expect([stranger.status, stranger.json.error.code]).toEqual([403, "NotAMember"]);
    expect(JSON.stringify(stranger.json)).not.toContain(VICTOR);
    const bad = await call("PATCH", `/seasons/${id}`, "andrea", { lengthWeeks: 5 });
    expect([bad.status, bad.json.error.code]).toEqual([422, "InvalidLengthWeeks"]);
  });

  it.each([
    ["malformed seasonId", "/seasons/nope", {}, "seasonId"],
    ["wrong type", `/seasons/${UNKNOWN_CIRCLE}`, { startDate: 20231115 }, "startDate"],
    [
      "unknown field (status is never editable)",
      `/seasons/${UNKNOWN_CIRCLE}`,
      { status: "active" },
      "status",
    ],
    ["no body", `/seasons/${UNKNOWN_CIRCLE}`, undefined, ""],
  ])("422 InvalidRequest on %s, no repository call", async (_l, path, body, field) => {
    const { call, transaction, read } = setup();
    const { status, json } = await call("PATCH", path, "andrea", body);
    expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(json.error.details.issues[0].path).toBe(field);
    expect(transaction).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("401 without a token", async () => {
    const { call, transaction } = setup();
    const { status, json } = await call("PATCH", `/seasons/${UNKNOWN_CIRCLE}`, null, {});
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
    expect(transaction).not.toHaveBeenCalled();
  });
});
