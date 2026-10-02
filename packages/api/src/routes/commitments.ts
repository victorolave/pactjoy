import {
  addCommitment,
  commitmentId,
  editCommitment,
  habitId,
  removeCommitment,
  seasonId,
} from "@pactjoy/app";
import { presentSeasonFor } from "../presenters/season.ts";
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

const commitmentParams = object({ seasonId: uuid, commitmentId: uuid });
// `habitId` is not editable (remove and re-add): sending it is an unknownField issue.
const editBody = object({
  weightPercent: number,
  privacy: oneOf(["visible", "private"]),
  measure: measureInput,
});
const none = object({});

export function commitmentRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "PUT",
      pattern: "/seasons/:seasonId/commitments/:commitmentId",
      async handle(ctx) {
        const input = validate(ctx, { params: commitmentParams, body: editBody });
        if (!input.ok) return input.result;
        const result = await editCommitment(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
          commitmentId: commitmentId(input.params.commitmentId),
          ...input.body,
        });
        return toResult(result, 200, presentSeasonFor);
      },
    },
    {
      method: "DELETE",
      pattern: "/seasons/:seasonId/commitments/:commitmentId",
      async handle(ctx) {
        const input = validate(ctx, { params: commitmentParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const result = await removeCommitment(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
          commitmentId: commitmentId(input.params.commitmentId),
        });
        return toResult(result, 200, presentSeasonFor);
      },
    },
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
        return toResult(result, 201, presentSeasonFor);
      },
    },
  ];
}
