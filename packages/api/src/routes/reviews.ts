import {
  commitmentId,
  commitmentStage,
  reviewDraft,
  seasonId,
  skipBaseline,
  submitReview,
} from "@pactjoy/app";
import {
  presentCommitmentStage,
  presentReviewDraft,
  presentSkippedBaseline,
  presentSubmittedReview,
} from "../presenters/review.ts";
import { uuid, weekIndexParam } from "../validation/formats.ts";
import { submitReviewBody } from "../validation/review.ts";
import { object } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const periodParams = object({ seasonId: uuid, periodIndex: weekIndexParam });
const stageParams = object({ seasonId: uuid, commitmentId: uuid });
const none = object({});

/**
 * The periodic review routes (ADR-0011 Q21, ADR-0014). Every route is the actor's OWN: the member
 * is the token's user and no route carries a member id, so there is no way to ask for another
 * member's review or stage. Only the owner-only read models come out (the port has no peer read).
 */
export function reviewRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/seasons/:seasonId/reviews/:periodIndex",
      async handle(ctx) {
        const input = validate(ctx, { params: periodParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await reviewDraft(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            periodIndex: input.params.periodIndex,
          }),
          200,
          presentReviewDraft,
        );
      },
    },
    {
      method: "POST",
      pattern: "/seasons/:seasonId/reviews/:periodIndex",
      async handle(ctx) {
        const input = validate(ctx, { params: periodParams, body: submitReviewBody });
        if (!input.ok) return input.result;
        return toResult(
          await submitReview(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            periodIndex: input.params.periodIndex,
            reflection: input.body.reflection,
            automaticity: input.body.automaticity.map((a) => ({
              commitmentId: commitmentId(a.commitmentId),
              items: a.items,
            })),
          }),
          201,
          presentSubmittedReview,
        );
      },
    },
    {
      method: "POST",
      pattern: "/seasons/:seasonId/reviews/:periodIndex/skip",
      async handle(ctx) {
        const input = validate(ctx, { params: periodParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await skipBaseline(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            periodIndex: input.params.periodIndex,
          }),
          200,
          presentSkippedBaseline,
        );
      },
    },
    {
      method: "GET",
      pattern: "/seasons/:seasonId/commitments/:commitmentId/stage",
      async handle(ctx) {
        const input = validate(ctx, { params: stageParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await commitmentStage(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            commitmentId: commitmentId(input.params.commitmentId),
          }),
          200,
          presentCommitmentStage,
        );
      },
    },
  ];
}
