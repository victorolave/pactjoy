import { deleteAccount, myCircle, profileSummary, today } from "@pactjoy/app";
import { apiFailure } from "../errors/api-error.ts";
import { appErrorResult } from "../errors/status-map.ts";
import { presentMyCircle } from "../presenters/circle.ts";
import { presentProfileSummary } from "../presenters/profile.ts";
import { presentToday } from "../presenters/today.ts";
import { object, string } from "../validation/schema.ts";
import { type ApiDeps, type Route, validate } from "./support.ts";

const none = object({});
// The word travels in the body (the route opts in to a DELETE body); the use case checks it.
const deleteAccountBody = object({ confirmation: string });

// A read of the caller's own screen: the actor comes from the token and the date from the server
// clock in the season's zone, so neither a client date nor a query parameter exists (TD-R1).
// A GET never carries a body. `today` is total, so there is no app error to map.
export function meRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/me/today",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return { status: 200, data: presentToday(await today(deps, ctx.actor)) };
      },
    },
    // The Circle tab's read model (Q16): no circle is 200 with nulls, never 404.
    {
      method: "GET",
      pattern: "/me/circle",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return { status: 200, data: presentMyCircle(await myCircle(deps, ctx.actor)) };
      },
    },
    // Perfil's consistency and habit stages (Q23): the caller's own, total (no circle is zeros),
    // and no member id anywhere in the path.
    {
      method: "GET",
      pattern: "/me/profile",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return {
          status: 200,
          data: presentProfileSummary(await profileSummary(deps, ctx.actor)),
        };
      },
    },
    // Account deletion (ADR-0019, Q26). Reachable only through the user pipeline: the job routes
    // are a separate table. Without a configured identity admin it answers 503 BEFORE any write,
    // because erasing the data and then failing the identity every time would strand the person.
    {
      method: "DELETE",
      pattern: "/me",
      allowsDeleteBody: true,
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: deleteAccountBody });
        if (!input.ok) return input.result;
        if (deps.identity === null) return apiFailure("ServiceUnavailable");
        const result = await deleteAccount(
          { ...deps, identity: deps.identity },
          ctx.actor,
          input.body,
        );
        if (!result.ok) return appErrorResult(result.error);
        try {
          // Nothing personal: no id, no name, no body.
          deps.logger.info("accountDeleted");
        } catch {
          // The account is gone; a logging failure must not turn that into an error.
        }
        return { status: 200, data: null };
      },
    },
  ];
}
