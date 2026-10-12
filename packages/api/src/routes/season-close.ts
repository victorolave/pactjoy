import {
  carryOver,
  commitmentId,
  seasonHistory,
  seasonId,
  seasonResults,
  submitSeasonClosure,
} from "@pactjoy/app";
import {
  presentCarryOver,
  presentSeasonHistory,
  presentSeasonResults,
  presentSubmittedClosure,
} from "../presenters/season-close.ts";
import { uuid } from "../validation/formats.ts";
import { object } from "../validation/schema.ts";
import { submitClosureBody } from "../validation/season-close.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const seasonParams = object({ seasonId: uuid });
const none = object({});

/**
 * The season-closure routes (ADR-0011 Q22, ADR-0015). Every route is the actor's OWN: the member
 * is the token's user and no route carries a member id, so there is no way to ask for another
 * member's results, closure or carry-over. The closure is one final POST (the client holds the
 * draft); there is no way to edit or redo it.
 */
export function seasonCloseRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/seasons/:seasonId/results",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await seasonResults(deps, ctx.actor, { seasonId: seasonId(input.params.seasonId) }),
          200,
          presentSeasonResults,
        );
      },
    },
    {
      method: "POST",
      pattern: "/seasons/:seasonId/closure",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: submitClosureBody });
        if (!input.ok) return input.result;
        return toResult(
          await submitSeasonClosure(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            decisions: input.body.decisions.map((d) => ({
              commitmentId: commitmentId(d.commitmentId),
              decision: d.decision,
            })),
          }),
          201,
          presentSubmittedClosure,
        );
      },
    },
    {
      method: "GET",
      pattern: "/seasons/:seasonId/carry-over",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await carryOver(deps, ctx.actor, { seasonId: seasonId(input.params.seasonId) }),
          200,
          presentCarryOver,
        );
      },
    },
    {
      method: "GET",
      pattern: "/me/seasons",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return { status: 200, data: presentSeasonHistory(await seasonHistory(deps, ctx.actor)) };
      },
    },
  ];
}
