import { pushConfig, removePushSubscription, savePushSubscription } from "@pactjoy/app";
import { appErrorResult } from "../errors/status-map.ts";
import { nullable, number, object, optional, string } from "../validation/schema.ts";
import { type ApiDeps, type Route, validate } from "./support.ts";

const none = object({});
/** `PushSubscription.toJSON()`; `expirationTime` is accepted and ignored. Shape only: the use case validates the values. */
const subscriptionBody = object({
  endpoint: string,
  expirationTime: optional(nullable(number)),
  keys: object({ p256dh: string, auth: string }),
});
const endpointBody = object({ endpoint: string });

// The caller's own device only (REQ-X1..X4): the user comes from the token, there is no id in the
// path, and no route ever returns an endpoint or a key. A body of the wrong shape is the usual 422
// InvalidRequest; a well-formed one the use case refuses is 422 InvalidPushSubscription.
export function pushRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/me/push-config",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return { status: 200, data: pushConfig(deps) };
      },
    },
    {
      method: "PUT",
      pattern: "/me/push-subscription",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: subscriptionBody });
        if (!input.ok) return input.result;
        const result = await savePushSubscription(deps, ctx.actor, {
          endpoint: input.body.endpoint,
          keys: input.body.keys,
        });
        return result.ok ? { status: 200, data: null } : appErrorResult(result.error);
      },
    },
    // A POST, not a DELETE: the endpoint travels in the body, and the pipeline refuses DELETE bodies.
    {
      method: "POST",
      pattern: "/me/push-subscription/remove",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: endpointBody });
        if (!input.ok) return input.result;
        const result = await removePushSubscription(deps, ctx.actor, input.body);
        return result.ok ? { status: 200, data: null } : appErrorResult(result.error);
      },
    },
  ];
}
