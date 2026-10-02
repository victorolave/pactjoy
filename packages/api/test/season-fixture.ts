import { expect } from "vitest";
import { createCircleBody } from "../src/testing/index.ts";
import { setup, VICTOR } from "./harness.ts";

export const REACH = {
  unit: "minutes",
  direction: "reach",
  minimum: "10",
  ideal: "30",
  schedule: { period: "weeklyTotal" },
};
export const DONE = { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } };

/**
 * Andrea has one private and one visible commitment; Victor is a second active member, with an
 * own full-weight visible commitment when `victorCommitment` is set.
 */
export async function givenSeason(options: { victorCommitment?: boolean } = {}) {
  const ctx = setup();
  const circle = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
  const circleId: string = circle.json.data.id;
  const season = await ctx.call("POST", `/circles/${circleId}/seasons`, "andrea", {
    timezone: "America/Bogota",
    startDate: "2023-11-15",
    lengthWeeks: 4,
  });
  const seasonId: string = season.json.data.id;
  const path = `/seasons/${seasonId}`;
  const add = async (
    token: "andrea" | "victor",
    name: string,
    privacy: string,
    weightPercent: number,
    measure: object,
  ) => {
    const habit = await ctx.call("POST", "/habits", token, { name });
    const body = { habitId: habit.json.data.id, weightPercent, privacy, measure };
    const created = await ctx.call("POST", `${path}/commitments`, token, body);
    expect(created.status).toBe(201);
    const mine = created.json.data.commitments.at(-1);
    return { habitId: habit.json.data.id as string, commitmentId: mine.id as string };
  };
  const secret = await add("andrea", "Secret-habit", "private", 60, REACH);
  const open = await add("andrea", "Open-habit", "visible", 40, DONE);
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
  const own = options.victorCommitment
    ? await add("victor", "Victor-habit", "visible", 100, DONE)
    : null;
  return {
    ...ctx,
    circleId,
    secretHabit: secret.habitId,
    secretCommitmentId: secret.commitmentId,
    openHabit: open.habitId,
    openCommitmentId: open.commitmentId,
    victorCommitmentId: own?.commitmentId ?? "",
    path,
  };
}
