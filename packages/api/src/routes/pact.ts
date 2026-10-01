import { approvePact, seasonId, withdrawApproval } from "@pactjoy/app";
import { presentSeason } from "../presenters/season.ts";
import { uuid } from "../validation/formats.ts";
import { object } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const seasonParams = object({ seasonId: uuid });
const none = object({});

/** The approval is a sub-resource of the season: PUT approves, DELETE withdraws (no body). */
export function pactRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "PUT",
      pattern: "/seasons/:seasonId/approval",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const result = await approvePact(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
        });
        return toResult(result, 200, presentSeason);
      },
    },
    {
      method: "DELETE",
      pattern: "/seasons/:seasonId/approval",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const result = await withdrawApproval(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
        });
        return toResult(result, 200, presentSeason);
      },
    },
  ];
}
