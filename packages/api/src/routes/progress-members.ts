import { memberId, memberProgress, seasonId } from "@pactjoy/app";
import { presentMemberProgress } from "../presenters/progress-member.ts";
import { uuid } from "../validation/formats.ts";
import { object } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const params = object({ seasonId: uuid, memberId: uuid });
const body = object({});

export function memberProgressRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/seasons/:seasonId/members/:memberId/progress",
      async handle(ctx) {
        const input = validate(ctx, { params, body, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await memberProgress(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            memberId: memberId(input.params.memberId),
          }),
          200,
          presentMemberProgress,
        );
      },
    },
  ];
}
