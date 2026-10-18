import {
  type Actor,
  admitJoinAttempt,
  circleId,
  createCircle,
  generateInvite,
  joinCircle,
  leaveCircle,
  previewInvite,
  renameCircle,
  renameMyDisplayName,
} from "@pactjoy/app";
import { appErrorResult } from "../errors/status-map.ts";
import { createNetworkKeyer } from "../http/network-key.ts";
import type { RequestContext } from "../http/pipeline.ts";
import type { ApiResult } from "../http/types.ts";
import { presentCircle, presentInvite, presentInvitePreview } from "../presenters/circle.ts";
import { inviteCode, uuid } from "../validation/formats.ts";
import { object, string } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const circleParams = object({ circleId: uuid });
const named = object({ name: string });
const createBody = object({ name: string, displayName: string });
const displayNamed = object({ displayName: string });
const none = object({});
// Preview is lenient on purpose: a malformed code is the same 404 as an unknown one (IP-R2).
const previewBody = object({ inviteCode: string });
const joinBody = object({ inviteCode, displayName: string });

export function circleRoutes(deps: ApiDeps): Route[] {
  const networkKey = deps.rateLimitKey === null ? null : createNetworkKeyer(deps.rateLimitKey);
  /**
   * Counts a well-formed join attempt before the use case runs (ADR-0020): `null` lets it go on,
   * otherwise the 429 to answer. The code plays no part, so a refusal never hints whether it
   * exists. A malformed body is a 422 before this point: it tells nothing about any code, so it is
   * not counted and never touches the store. The network is passed on only as its keyed hash.
   */
  const throttle = async (ctx: RequestContext<Actor>): Promise<ApiResult | null> => {
    const network =
      networkKey === null || ctx.clientNetwork === null
        ? null
        : await networkKey(ctx.clientNetwork);
    const admitted = await admitJoinAttempt(deps, ctx.actor, { networkKey: network });
    return admitted.ok ? null : appErrorResult(admitted.error);
  };

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
      method: "PATCH",
      pattern: "/circles/:circleId/members/me",
      async handle(ctx) {
        const input = validate(ctx, { params: circleParams, body: displayNamed });
        if (!input.ok) return input.result;
        // The member is the token's actor: there is no member id in the URL or the body.
        const result = await renameMyDisplayName(deps, ctx.actor, {
          circleId: circleId(input.params.circleId),
          displayName: input.body.displayName,
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
        const refused = await throttle(ctx);
        if (refused !== null) return refused;
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
      pattern: "/circles/join/preview",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: previewBody });
        if (!input.ok) return input.result;
        const refused = await throttle(ctx);
        if (refused !== null) return refused;
        // Read-only; the code lives in the body, never the URL, so it stays out of logs.
        const result = await previewInvite(deps, ctx.actor, { inviteCode: input.body.inviteCode });
        return toResult(result, 200, presentInvitePreview);
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
