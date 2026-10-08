import { seasonId, seasonProgress } from "@pactjoy/app";
import { presentSeasonProgress } from "../presenters/progress-season.ts";
import { uuid } from "../validation/formats.ts";
import { object } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const params = object({ seasonId: uuid });
const body = object({});

export function seasonProgressRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/seasons/:seasonId/progress",
      async handle(ctx) {
        const input = validate(ctx, { params, body, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await seasonProgress(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
          }),
          200,
          presentSeasonProgress,
        );
      },
    },
  ];
}
