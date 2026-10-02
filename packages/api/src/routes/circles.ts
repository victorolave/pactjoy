import {
  circleId,
  createCircle,
  generateInvite,
  joinCircle,
  leaveCircle,
  renameCircle,
} from "@pactjoy/app";
import { presentCircle, presentInvite } from "../presenters/circle.ts";
import { inviteCode, uuid } from "../validation/formats.ts";
import { object, string } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const circleParams = object({ circleId: uuid });
const named = object({ name: string });
const createBody = object({ name: string, displayName: string });
const none = object({});
const joinBody = object({ inviteCode, displayName: string });

export function circleRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: "/circles",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: createBody });
        if (!input.ok) return input.result;
        const result = await createCircle(deps, ctx.actor, {
          name: input.body.name,
          displayName: input.body.displayName,
        });
        return toResult(result, 201, (circle) => presentCircle(circle, ctx.actor));
      },
    },
    {
      method: "PATCH",
      pattern: "/circles/:circleId",
      async handle(ctx) {
        const input = validate(ctx, { params: circleParams, body: named });
        if (!input.ok) return input.result;
        const result = await renameCircle(deps, ctx.actor, {
          circleId: circleId(input.params.circleId),
          name: input.body.name,
        });
        return toResult(result, 200, (circle) => presentCircle(circle, ctx.actor));
      },
    },
    {
      method: "POST",
      pattern: "/circles/:circleId/invite",
      async handle(ctx) {
        const input = validate(ctx, { params: circleParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const result = await generateInvite(deps, ctx.actor, {
          circleId: circleId(input.params.circleId),
        });
        return toResult(result, 201, presentInvite);
      },
    },
    {
      method: "POST",
      pattern: "/circles/join",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: joinBody });
        if (!input.ok) return input.result;
        // The raw code is passed on: the app normalizes it. It lives in the body, never the URL.
        const result = await joinCircle(deps, ctx.actor, {
          inviteCode: input.body.inviteCode,
          displayName: input.body.displayName,
        });
        return toResult(result, 200, (circle) => presentCircle(circle, ctx.actor));
      },
    },
    {
      method: "POST",
      pattern: "/circles/:circleId/leave",
      async handle(ctx) {
        const input = validate(ctx, { params: circleParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        const result = await leaveCircle(deps, ctx.actor, {
          circleId: circleId(input.params.circleId),
        });
        return toResult(result, 200, (circle) => presentCircle(circle, ctx.actor));
      },
    },
  ];
}
