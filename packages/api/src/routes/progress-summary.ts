import { seasonId, weekSummary } from "@pactjoy/app";
import { presentWeekSummary } from "../presenters/progress-week.ts";
import { uuid, weekIndexParam } from "../validation/formats.ts";
import { object } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const params = object({ seasonId: uuid, weekIndex: weekIndexParam });
const body = object({});

export function weekSummaryRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/seasons/:seasonId/weeks/:weekIndex/summary",
      async handle(ctx) {
        const input = validate(ctx, { params, body, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await weekSummary(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            weekIndex: input.params.weekIndex,
          }),
          200,
          presentWeekSummary,
        );
      },
    },
  ];
}
