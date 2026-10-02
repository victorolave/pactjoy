import { describe, expect, it } from "vitest";
import { createCircleBody } from "../src/testing/index.ts";
import { setup, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

const DONE = { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } };
const REACH = {
  unit: "minutes",
  direction: "reach",
  minimum: "10",
  ideal: "30",
  schedule: { period: "weeklyTotal" },
};
const LIMIT = {
  unit: "glasses",
  direction: "limit",
  ideal: "2",
  tolerance: "3",
  schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [1, 3] } },
};
const NOWHERE = `/seasons/${UNKNOWN_CIRCLE}/commitments`;
const OK = { habitId: UNKNOWN_CIRCLE, weightPercent: 100, privacy: "visible", measure: DONE };
const withMeasure = (measure: unknown) => ({ ...OK, measure });

async function givenSeason() {
  const ctx = setup();
  const circle = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
  const season = await ctx.call("POST", `/circles/${circle.json.data.id}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate: "2023-11-15",
    lengthWeeks: 4,
  });
  const habit = await ctx.call("POST", "/habits", "andrea", { name: "Run" });
  const seasonId: string = season.json.data.id;
  const habitId: string = habit.json.data.id;
  const body = (measure: unknown, extra: object = {}) => ({ ...OK, habitId, measure, ...extra });
  return { ...ctx, seasonId, habitId, body, path: `/seasons/${seasonId}/commitments` };
}

describe("POST /seasons/:seasonId/commitments (UE-S-S5)", () => {
  it("201 returns the season; thresholds are exact strings, no userId", async () => {
    const { call, path, body, habitId } = await givenSeason();
    const { status, json } = await call("POST", path, "andrea", body(REACH));
    expect(status).toBe(201);
    expect(json.data.commitments).toHaveLength(1);
    expect(json.data.commitments[0]).toMatchObject({
      kind: "detail",
      habitId,
      weightPercent: 100,
      privacy: "visible",
    });
    expect(JSON.stringify(json.data.commitments[0].measure)).toContain('"10"');
    expect(JSON.stringify(json)).not.toContain("aaaaaaaa-0000-4000-8000-000000000001");
  });

  it.each([
    ["done", DONE],
    ["limit with specific days", LIMIT],
    ["custom unit", { ...REACH, unit: "custom", customLabel: "reps", precision: "integer" }],
    ["null customLabel", { ...REACH, customLabel: null }],
  ])("accepts the %s measure shape", async (_l, measure) => {
    const { call, path, body } = await givenSeason();
    const { status } = await call("POST", path, "andrea", body(measure));
    expect(status).toBe(201);
  });

  const customReach = (extra: object) => ({ ...REACH, unit: "custom", ...extra });
  const days = (weekdays: number[]) => ({
    ...DONE,
    frequency: { kind: "specificDays", weekdays },
  });
  it.each([
    ["MinimumExceedsIdeal", { ...REACH, minimum: "5", ideal: "3" }, {}],
    ["MinimumNotPositive", { ...REACH, minimum: "0" }, {}],
    ["IdealExceedsTolerance", { ...LIMIT, ideal: "9" }, {}],
    ["InvalidWeight", REACH, { weightPercent: 7 }],
    ["InvalidQuantity", { ...REACH, minimum: "1.234" }, {}],
    ["IntegerRequired", { ...REACH, unit: "pages", minimum: "2.5" }, {}],
    ["CustomLabelMalformed", customReach({ customLabel: "a\u0000b" }), {}],
    ["CustomLabelBlank", customReach({ customLabel: "  " }), {}],
    ["InvalidTimesPerWeek", { ...DONE, frequency: { kind: "timesPerWeek", times: 0 } }, {}],
    ["NoWeekdays", days([]), {}],
    ["DuplicateWeekday", days([1, 1]), {}],
    ["InvalidWeekday", days([9]), {}],
    ["InvalidPrecision", customReach({ customLabel: "x", precision: "foo" }), {}],
    ["PrecisionNotApplicable", { ...REACH, unit: "pages", precision: "decimal" }, {}],
  ])("UE-S-S6/S7: the app answers 422 %s (not duplicated here)", async (kind, measure, extra) => {
    const { call, path, body } = await givenSeason();
    const { status, json } = await call("POST", path, "andrea", body(measure, extra));
    expect([status, json.error.code]).toEqual([422, kind]);
  });

  it("maps SeasonNotFound 404, NotAMember 403, PactNotOpen 409", async () => {
    const { app, call, path, body, seasonId } = await givenSeason();
    const missing = await call("POST", NOWHERE, "andrea", body(DONE));
    expect([missing.status, missing.json.error.code]).toEqual([404, "SeasonNotFound"]);
    const stranger = await call("POST", path, "victor", body(DONE));
    expect([stranger.status, stranger.json.error.code]).toEqual([403, "NotAMember"]);
    expect(JSON.stringify(stranger.json)).not.toContain(VICTOR);
    const season = await app.seasons.get(seasonId as never);
    if (!season) throw new Error("fixture setup failed");
    await app.seasons.save({ ...season, status: "active", version: 9 }, season.version);
    const closed = await call("POST", path, "andrea", body(DONE));
    expect([closed.status, closed.json.error.code]).toEqual([409, "PactNotOpen"]);
  });

  it("a private commitment is hidden for everyone (Q2 design default)", async () => {
    const { call, path, body } = await givenSeason();
    const { json } = await call("POST", path, "andrea", body(DONE, { privacy: "private" }));
    expect(json.data.commitments[0].kind).toBe("hidden");
    expect(json.data.commitments[0].measure).toBeUndefined();
  });

  const nested = (measure: unknown) => withMeasure(measure);
  it.each([
    ["malformed seasonId", "/seasons/nope/commitments", OK, "seasonId"],
    ["no body", NOWHERE, undefined, ""],
    ["non-uuid habitId", NOWHERE, { ...OK, habitId: "x" }, "habitId"],
    ["weightPercent as string", NOWHERE, { ...OK, weightPercent: "50" }, "weightPercent"],
    ["privacy out of the enum (RV-S13)", NOWHERE, { ...OK, privacy: "public" }, "privacy"],
    ["unknown top-level field", NOWHERE, { ...OK, status: "x" }, "status"],
    ["minimum as a number (RV-S12)", NOWHERE, nested({ ...REACH, minimum: 5 }), "measure.minimum"],
    [
      "limit without tolerance",
      NOWHERE,
      nested({ ...LIMIT, tolerance: undefined }),
      "measure.tolerance",
    ],
    ["unknown key in a limit measure", NOWHERE, nested({ ...LIMIT, x: 1 }), "measure.x"],
    ["unknown key in a done measure", NOWHERE, nested({ ...DONE, x: 1 }), "measure.x"],
    ["unknown unit", NOWHERE, nested({ ...REACH, unit: "parsecs" }), "measure.unit"],
    ["unknown direction", NOWHERE, nested({ ...REACH, direction: "up" }), "measure.direction"],
    [
      "done with a direction",
      NOWHERE,
      nested({ ...DONE, direction: "reach" }),
      "measure.direction",
    ],
    [
      "unknown key in schedule (RV-S8)",
      NOWHERE,
      nested({ ...REACH, schedule: { period: "weeklyTotal", x: 1 } }),
      "measure.schedule.x",
    ],
    [
      "unknown key in frequency (RV-S8)",
      NOWHERE,
      nested({ ...DONE, frequency: { kind: "timesPerWeek", times: 1, x: 1 } }),
      "measure.frequency.x",
    ],
    [
      "weekdays not an array (UE-S-S8)",
      NOWHERE,
      nested({ ...DONE, frequency: { kind: "specificDays", weekdays: "1" } }),
      "measure.frequency.weekdays",
    ],
    [
      "unknown frequency kind",
      NOWHERE,
      nested({ ...DONE, frequency: { kind: "daily" } }),
      "measure.frequency.kind",
    ],
    [
      "unknown period",
      NOWHERE,
      nested({ ...REACH, schedule: { period: "monthly" } }),
      "measure.schedule.period",
    ],
    ["measure not an object", NOWHERE, nested("done"), "measure"],
    ...["__proto__", "constructor", 1, {}].map((direction) => [
      `direction ${JSON.stringify(direction)} is not an own variant`,
      NOWHERE,
      nested({ ...REACH, direction }),
      "measure.direction",
    ]),
    [
      "period inherited name (toString)",
      NOWHERE,
      nested({ ...REACH, schedule: { period: "toString" } }),
      "measure.schedule.period",
    ],
    [
      "frequency kind __proto__",
      NOWHERE,
      nested({ ...DONE, frequency: { kind: "__proto__" } }),
      "measure.frequency.kind",
    ],
  ] as [string, string, unknown, string][])(
    "422 InvalidRequest on %s, no repository call",
    async (_l, path, body, field) => {
      const { call, transaction, read } = setup();
      const { status, json } = await call("POST", path, "andrea", body);
      expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
      expect(json.error.details.issues[0].path).toBe(field);
      expect(transaction).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("an own __proto__ key from raw JSON text is an unknownField (422)", async () => {
    const { callRaw, transaction } = setup();
    const text = `{"habitId":"${UNKNOWN_CIRCLE}","weightPercent":100,"privacy":"visible","__proto__":{"x":1},"measure":${JSON.stringify(DONE)}}`;
    const { status, json } = await callRaw("POST", NOWHERE, "andrea", text);
    expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(json.error.details.issues[0]).toMatchObject({
      path: "__proto__",
      problem: "unknownField",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("401 without a token", async () => {
    const { call, transaction } = setup();
    const { status, json } = await call("POST", NOWHERE, null, OK);
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
    expect(transaction).not.toHaveBeenCalled();
  });
});
