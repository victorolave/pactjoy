import { addCommitment, habitId, seasonId } from "@pactjoy/app";
import { presentSeason } from "../presenters/season.ts";
import { uuid } from "../validation/formats.ts";
import { measureInput } from "../validation/measure.ts";
import { number, object, oneOf } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const seasonParams = object({ seasonId: uuid });
const addBody = object({
  habitId: uuid,
  weightPercent: number,
  privacy: oneOf(["visible", "private"]),
  measure: measureInput,
});

export function commitmentRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: "/seasons/:seasonId/commitments",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: addBody });
        if (!input.ok) return input.result;
        const result = await addCommitment(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
          ...input.body,
          habitId: habitId(input.body.habitId),
        });
        return toResult(result, 201, presentSeason);
      },
    },
  ];
}
