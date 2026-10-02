import { describe, expect, it } from "vitest";
import { createCircleBody } from "../src/testing/index.ts";
import { setup, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

const REACH = {
  unit: "minutes",
  direction: "reach",
  minimum: "10",
  ideal: "30",
  schedule: { period: "weeklyTotal" },
};
const DONE = { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } };

/** Andrea has one private and one visible commitment; Victor is a second active member. */
async function givenSeason() {
  const ctx = setup();
  const circle = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
  const circleId: string = circle.json.data.id;
  const season = await ctx.call("POST", `/circles/${circleId}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate: "2023-11-15",
    lengthWeeks: 4,
  });
  const seasonId: string = season.json.data.id;
  const add = async (name: string, privacy: string, weightPercent: number, measure: object) => {
    const habit = await ctx.call("POST", "/habits", "andrea", { name });
    const body = { habitId: habit.json.data.id, weightPercent, privacy, measure };
    const created = await ctx.call("POST", `/seasons/${seasonId}/commitments`, "andrea", body);
    expect(created.status).toBe(201);
    return habit.json.data.id as string;
  };
  const secretHabit = await add("Secret-habit", "private", 60, REACH);
  const openHabit = await add("Open-habit", "visible", 40, DONE);
  const stored = await ctx.app.circles.get(circleId as never);
  if (!stored) throw new Error("fixture setup failed");
  const victor = {
    userId: VICTOR,
    id: "m-victor",
    status: "active",
    joinedAt: ctx.app.clock.now(),
  };
  await ctx.app.circles.save(
    { ...stored, members: [...stored.members, victor as never], version: 9 },
    stored.version,
  );
  return { ...ctx, circleId, secretHabit, openHabit, path: `/seasons/${seasonId}` };
}

describe("GET /seasons/:seasonId (SV-S1..S4, SV-S7)", () => {
  it("SV-S1: the owner sees their own private commitment in full, marked private", async () => {
    const { call, path, secretHabit } = await givenSeason();
    const { status, json } = await call("GET", path, "andrea");
    expect(status).toBe(200);
    const [secret, open] = json.data.commitments;
    expect(secret).toMatchObject({
      kind: "detail",
      habitId: secretHabit,
      weightPercent: 60,
      privacy: "private",
      measure: { unit: "minutes", target: { minimum: "10", ideal: "30" } },
    });
    expect(open).toMatchObject({ kind: "detail", weightPercent: 40, privacy: "visible" });
  });

  it("SV-S2: another member sees the private commitment hidden, the visible one in full", async () => {
    const { call, path, openHabit } = await givenSeason();
    const { status, json } = await call("GET", path, "victor");
    expect(status).toBe(200);
    const [secret, open] = json.data.commitments;
    expect(secret).toEqual({
      kind: "hidden",
      id: expect.any(String),
      memberId: expect.any(String),
      weightPercent: 60,
    });
    expect(open).toMatchObject({ kind: "detail", habitId: openHabit });
    expect(JSON.stringify(json)).not.toContain("minutes");
  });

  it("SV-S3: a user outside the circle gets 403 NotAMember and no data", async () => {
    const { call, path, app, circleId } = await givenSeason();
    const stored = await app.circles.get(circleId as never);
    if (!stored) throw new Error("fixture setup failed");
    await app.circles.save(
      { ...stored, members: stored.members.filter((m) => m.userId !== VICTOR), version: 10 },
      stored.version,
    );
    const { status, json } = await call("GET", path, "victor");
    expect([status, json.error.code]).toEqual([403, "NotAMember"]);
    expect(json.data).toBeUndefined();
  });

  it("SV-S4: an unknown season is 404 SeasonNotFound", async () => {
    const { call } = await givenSeason();
    const { status, json } = await call("GET", `/seasons/${UNKNOWN_CIRCLE}`, "andrea");
    expect([status, json.error.code]).toEqual([404, "SeasonNotFound"]);
  });

  it("SV-S7: pactRevision is present, and no userId leaks", async () => {
    const { call, path } = await givenSeason();
    const { json } = await call("GET", path, "andrea");
    expect(json.data.pactRevision).toBeGreaterThan(0);
    expect(JSON.stringify(json)).not.toContain("aaaaaaaa-0000-4000-8000-00000000000");
  });

  it("a malformed id is rejected before the use case", async () => {
    const { call } = await givenSeason();
    const { status } = await call("GET", "/seasons/not-a-uuid", "andrea");
    expect(status).toBe(422);
  });
});
