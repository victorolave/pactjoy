import { approvePact, seasonId, withdrawApproval } from "@pactjoy/app";
import { presentSeasonFor } from "../presenters/season.ts";
import { uuid } from "../validation/formats.ts";
import { integer, object } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const seasonParams = object({ seasonId: uuid });
const none = object({});
const approveBody = object({ expectedPactRevision: integer({ min: 0 }) });

/**
 * The approval is a sub-resource of the season: PUT approves the pact revision the caller saw
 * (required `expectedPactRevision`, else 422), DELETE withdraws (no body).
 */
export function pactRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "PUT",
      pattern: "/seasons/:seasonId/approval",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: approveBody });
        if (!input.ok) return input.result;
        const result = await approvePact(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
          expectedPactRevision: input.body.expectedPactRevision,
        });
        return toResult(result, 200, presentSeasonFor);
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
        return toResult(result, 200, presentSeasonFor);
      },
    },
  ];
}
