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
  const circle = await ctx.call("POST", "/circles", "andrea", { name: "Crew" });
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
  await ctx.call("PUT", `/seasons/${seasonId}/approval`, "andrea");
  return { ...ctx, seasonId, commitmentId, path: `/seasons/${seasonId}/entries` };
}
