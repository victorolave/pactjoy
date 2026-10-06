import { createHabit, habitId, listMyHabits, updateHabit } from "@pactjoy/app";
import { presentHabit } from "../presenters/habit.ts";
import { uuid } from "../validation/formats.ts";
import { integer, nullable, object, optional, string } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const none = object({});
const habitParams = object({ habitId: uuid });
// Only the TYPE is checked here: the app owns name/why/category/icon content rules.
const habitBody = object({
  name: string,
  why: nullable(optional(string)),
  category: nullable(optional(string)),
  icon: nullable(optional(string)),
});
// A partial edit: every field but the version is optional (absent = unchanged, null clears).
const patchBody = object({
  expectedVersion: integer({ min: 0 }),
  name: optional(string),
  why: nullable(optional(string)),
  category: nullable(optional(string)),
  icon: nullable(optional(string)),
});

export function habitRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: "/habits",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: habitBody });
        if (!input.ok) return input.result;
        const result = await createHabit(deps, ctx.actor, input.body);
        return toResult(result, 201, presentHabit);
      },
    },
    // A read of the caller's own habits; `listMyHabits` is total, so there is no app error to map.
    {
      method: "GET",
      pattern: "/habits",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const habits = await listMyHabits(deps, ctx.actor);
        return { status: 200, data: { habits: habits.map(presentHabit) } };
      },
    },
    {
      method: "PATCH",
      pattern: "/habits/:habitId",
      async handle(ctx) {
        const input = validate(ctx, { params: habitParams, body: patchBody });
        if (!input.ok) return input.result;
        const { expectedVersion, ...patch } = input.body;
        const result = await updateHabit(deps, ctx.actor, {
          ...patch,
          habitId: habitId(input.params.habitId),
          expectedVersion,
        });
        return toResult(result, 200, presentHabit);
      },
    },
  ];
}
