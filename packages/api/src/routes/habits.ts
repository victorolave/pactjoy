import { createHabit } from "@pactjoy/app";
import { presentHabit } from "../presenters/habit.ts";
import { nullable, object, optional, string } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const none = object({});
// Only the TYPE is checked here: the app owns name/why/category content rules.
const habitBody = object({
  name: string,
  why: nullable(optional(string)),
  category: nullable(optional(string)),
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
  ];
}
