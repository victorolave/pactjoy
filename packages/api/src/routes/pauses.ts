import {
  cancelPauseRequest,
  commitmentId,
  myPauseRequests,
  type PauseScope,
  pauseApprovalViews,
  pauseRequestId,
  pauseRequestViews,
  requestPause,
  respondToPause,
  resumePause,
  seasonId,
} from "@pactjoy/app";
import { appErrorResult } from "../errors/status-map.ts";
import {
  presentMyPauseRequests,
  presentPauseApproval,
  presentPauseRequest,
} from "../presenters/pause.ts";
import { uuid } from "../validation/formats.ts";
import { requestPauseBody, respondBody, resumeBody } from "../validation/pause.ts";
import { object } from "../validation/schema.ts";
import { type ApiDeps, type Route, validate } from "./support.ts";

const seasonParams = object({ seasonId: uuid });
const requestParams = object({ pauseRequestId: uuid });
const none = object({});

function toScope(
  scope: { kind: "all" } | { kind: "commitment"; commitmentId: string },
): PauseScope {
  return scope.kind === "all"
    ? { kind: "all" }
    : { kind: "commitment", commitmentId: commitmentId(scope.commitmentId) };
}

/**
 * The pause routes (ADR-0011 Q20, ADR-0013). The actor is the token's user; the member never
 * travels in a body. A use case returns the stored request and the presenter's context (habit
 * names, display names, the private Commitment) is read next, so the view is the one the
 * caller is allowed to see: the requester's own, or the approver's with a private Commitment hidden.
 */
export function pauseRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: "/seasons/:seasonId/pause-requests",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: requestPauseBody });
        if (!input.ok) return input.result;
        const result = await requestPause(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
          scope: toScope(input.body.scope),
          reason: input.body.reason,
          note: input.body.note,
          startDate: input.body.startDate,
          endDate: input.body.endDate,
        });
        if (!result.ok) return appErrorResult(result.error);
        const [view] = await pauseRequestViews(deps, [result.value]);
        if (!view) throw new Error("a stored pause request has no view");
        return { status: 201, data: presentPauseRequest(view) };
      },
    },
    // The pause screens' read model (PA-2): total, so no circle or season is 200 with empty lists.
    {
      method: "GET",
      pattern: "/me/pause-requests",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const view = await myPauseRequests(deps, ctx.actor);
        const [mine, awaiting] = await Promise.all([
          pauseRequestViews(deps, view.mine),
          pauseApprovalViews(deps, view.awaitingMe),
        ]);
        return { status: 200, data: presentMyPauseRequests(view, mine, awaiting) };
      },
    },
    {
      method: "PUT",
      pattern: "/pause-requests/:pauseRequestId/response",
      async handle(ctx) {
        const input = validate(ctx, { params: requestParams, body: respondBody });
        if (!input.ok) return input.result;
        const result = await respondToPause(deps, ctx.actor, {
          pauseRequestId: pauseRequestId(input.params.pauseRequestId),
          decision: input.body.decision,
        });
        if (!result.ok) return appErrorResult(result.error);
        // The caller is an approver: their answer is the one just set (a success means it stands).
        const [view] = await pauseApprovalViews(deps, [
          { request: result.value, myResponse: input.body.decision },
        ]);
        if (!view) throw new Error("a stored pause request has no view");
        return { status: 200, data: presentPauseApproval(view) };
      },
    },
    {
      method: "DELETE",
      pattern: "/pause-requests/:pauseRequestId",
      async handle(ctx) {
        const input = validate(ctx, { params: requestParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const result = await cancelPauseRequest(deps, ctx.actor, {
          pauseRequestId: pauseRequestId(input.params.pauseRequestId),
        });
        if (!result.ok) return appErrorResult(result.error);
        const [view] = await pauseRequestViews(deps, [result.value]);
        if (!view) throw new Error("a stored pause request has no view");
        return { status: 200, data: presentPauseRequest(view) };
      },
    },
    {
      method: "POST",
      pattern: "/pause-requests/:pauseRequestId/resume",
      async handle(ctx) {
        const input = validate(ctx, {
          params: requestParams,
          body: resumeBody,
          emptyBody: "object",
        });
        if (!input.ok) return input.result;
        const result = await resumePause(deps, ctx.actor, {
          pauseRequestId: pauseRequestId(input.params.pauseRequestId),
          ...(input.body.commitmentId === undefined
            ? {}
            : { commitmentId: commitmentId(input.body.commitmentId) }),
        });
        if (!result.ok) return appErrorResult(result.error);
        const [view] = await pauseRequestViews(deps, [result.value]);
        if (!view) throw new Error("a stored pause request has no view");
        return { status: 200, data: presentPauseRequest(view) };
      },
    },
  ];
}
