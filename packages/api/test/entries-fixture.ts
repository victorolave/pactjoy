import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";
import { setup } from "./harness.ts";

export const DONE = { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } };
export const MINUTES = {
  unit: "minutes",
  direction: "reach",
  minimum: "10",
  ideal: "30",
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
};
export const DONE_BODY = { value: { kind: "done" }, clientRequestId: "req-1" };

/** The clock sits on 2023-11-14 (America/Bogota): a season starting today is active once the pact closes. */
export async function givenActiveSeason(measure: object = DONE) {
  const ctx = setup();
  const circle = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
  const season = await ctx.call("POST", `/circles/${circle.json.data.id}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate: "2023-11-14",
    lengthWeeks: 4,
  });
  const habit = await ctx.call("POST", "/habits", "andrea", { name: "Run" });
  const seasonId: string = season.json.data.id;
  const added = await ctx.call("POST", `/seasons/${seasonId}/commitments`, "andrea", {
    habitId: habit.json.data.id,
    weightPercent: 100,
    privacy: "visible",
    measure,
  });
  const commitmentId: string = added.json.data.commitments[0].id;
  const approval = { expectedPactRevision: added.json.data.pactRevision };
  await ctx.call("PUT", `/seasons/${seasonId}/approval`, "andrea", approval);
  return { ...ctx, seasonId, commitmentId, path: `/seasons/${seasonId}/entries` };
}

/** Andrea owns the circle, Victor joins before the season; both commit and approve. */
export async function givenTwoMemberSeason(measure: object = DONE) {
  const ctx = setup();
  const circle = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
  const circleId: string = circle.json.data.id;
  const invite = await ctx.call("POST", `/circles/${circleId}/invite`, "andrea");
  await ctx.call("POST", "/circles/join", "victor", joinCircleBody(invite.json.data.code));
  const season = await ctx.call("POST", `/circles/${circleId}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate: "2023-11-14",
    lengthWeeks: 4,
  });
  const seasonId: string = season.json.data.id;
  const commitmentIds: Record<"andrea" | "victor", string> = { andrea: "", victor: "" };
  let pactRevision = 0;
  for (const who of ["andrea", "victor"] as const) {
    const habit = await ctx.call("POST", "/habits", who, { name: `Run ${who}` });
    const added = await ctx.call("POST", `/seasons/${seasonId}/commitments`, who, {
      habitId: habit.json.data.id,
      weightPercent: 100,
      privacy: "visible",
      measure,
    });
    const mine = added.json.data.commitments.find(
      (c: { habitId?: string }) => c.habitId === habit.json.data.id,
    );
    commitmentIds[who] = mine.id;
    pactRevision = added.json.data.pactRevision;
  }
  const approval = { expectedPactRevision: pactRevision };
  await ctx.call("PUT", `/seasons/${seasonId}/approval`, "andrea", approval);
  await ctx.call("PUT", `/seasons/${seasonId}/approval`, "victor", approval);
  return { ...ctx, circleId, seasonId, commitmentIds, path: `/seasons/${seasonId}/entries` };
}
