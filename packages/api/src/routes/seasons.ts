import {
  circleId,
  createSeason,
  editSeasonParams,
  type ReviewCadenceWeeks,
  type SeasonLengthWeeks,
  seasonId,
} from "@pactjoy/app";
import { presentSeason } from "../presenters/season.ts";
import { uuid } from "../validation/formats.ts";
import { number, object, optional, string } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const circleParams = object({ circleId: uuid });
const seasonParams = object({ seasonId: uuid });

// Only the TYPE is checked here: the app owns every domain rule (zone, date window, 4/6/8/12
// weeks, cadence). The numbers are narrowed by cast because the app re-checks them at runtime.
const createBody = object({
  timezone: string,
  startDate: string,
  lengthWeeks: number,
  reviewCadenceWeeks: optional(number),
});
const editBody = object({
  timezone: optional(string),
  startDate: optional(string),
  lengthWeeks: optional(number),
  reviewCadenceWeeks: optional(number),
});

const asLength = (n: number) => n as SeasonLengthWeeks;
const asCadence = (n: number) => n as ReviewCadenceWeeks;

export function seasonRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: "/circles/:circleId/seasons",
      async handle(ctx) {
        const input = validate(ctx, { params: circleParams, body: createBody });
        if (!input.ok) return input.result;
        const { timezone, startDate, lengthWeeks, reviewCadenceWeeks } = input.body;
        const result = await createSeason(deps, ctx.actor, {
          circleId: circleId(input.params.circleId),
          timezone,
          startDate,
          lengthWeeks: asLength(lengthWeeks),
          ...(reviewCadenceWeeks === undefined
            ? {}
            : { reviewCadenceWeeks: asCadence(reviewCadenceWeeks) }),
        });
        return toResult(result, 201, presentSeason);
      },
    },
    {
      method: "PATCH",
      pattern: "/seasons/:seasonId",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: editBody });
        if (!input.ok) return input.result;
        const { timezone, startDate, lengthWeeks, reviewCadenceWeeks } = input.body;
        const result = await editSeasonParams(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
          ...(timezone === undefined ? {} : { timezone }),
          ...(startDate === undefined ? {} : { startDate }),
          ...(lengthWeeks === undefined ? {} : { lengthWeeks: asLength(lengthWeeks) }),
          ...(reviewCadenceWeeks === undefined
            ? {}
            : { reviewCadenceWeeks: asCadence(reviewCadenceWeeks) }),
        });
        return toResult(result, 200, presentSeason);
      },
    },
  ];
}
