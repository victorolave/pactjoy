import { today } from "@pactjoy/app";
import { presentToday } from "../presenters/today.ts";
import { object } from "../validation/schema.ts";
import { type ApiDeps, type Route, validate } from "./support.ts";

const none = object({});

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
  ];
}
