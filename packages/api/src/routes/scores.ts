import { memberScore, seasonId, standings } from "@pactjoy/app";
import type { MemberId } from "@pactjoy/engine";
import { presentMemberScore, presentStandings } from "../presenters/score.ts";
import { uuid } from "../validation/formats.ts";
import { object } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const seasonParams = object({ seasonId: uuid });
const memberParams = object({ seasonId: uuid, memberId: uuid });
const none = object({});

// Reads only: each is one `uow.read` inside the use case, which also resolves the viewer, so
// there is no second round trip and no write transaction. A GET never carries a body.
export function scoreRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/seasons/:seasonId/score",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const result = await memberScore(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
        });
        return toResult(result, 200, presentMemberScore);
      },
    },
    {
      method: "GET",
      pattern: "/seasons/:seasonId/members/:memberId/score",
      async handle(ctx) {
        const input = validate(ctx, { params: memberParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const result = await memberScore(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
          memberId: input.params.memberId as MemberId,
        });
        return toResult(result, 200, presentMemberScore);
      },
    },
    {
      method: "GET",
      pattern: "/seasons/:seasonId/standings",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const result = await standings(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
        });
        return toResult(result, 200, presentStandings);
      },
    },
  ];
}
