import {
  commitmentId,
  getCommitmentReminder,
  type SetCommitmentReminderInput,
  seasonId,
  setCommitmentReminder,
} from "@pactjoy/app";
import { presentCommitmentReminder } from "../presenters/reminder.ts";
import { uuid } from "../validation/formats.ts";
import { array, boolean, integer, object } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const params = object({ seasonId: uuid, commitmentId: uuid });
const none = object({});
/** Shape only: the time grid, the weekday range and duplicates are the use case's rules (422 InvalidReminder). */
const reminderBody = object({
  enabled: boolean,
  minuteOfDay: integer({ min: 0 }),
  weekdays: array(integer({ min: 0 }), 7),
});

/**
 * A commitment's reminder (ADR-0017 addendum, D2). The owner's own only: the member is the token's
 * user and no route carries a member id, so another member's reminder is 404 CommitmentNotFound,
 * like an unknown commitment. It is a personal setting: saving it never touches the pact.
 */
export function reminderRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/seasons/:seasonId/commitments/:commitmentId/reminder",
      async handle(ctx) {
        const input = validate(ctx, { params, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await getCommitmentReminder(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            commitmentId: commitmentId(input.params.commitmentId),
          }),
          200,
          presentCommitmentReminder,
        );
      },
    },
    {
      method: "PUT",
      pattern: "/seasons/:seasonId/commitments/:commitmentId/reminder",
      async handle(ctx) {
        const input = validate(ctx, { params, body: reminderBody });
        if (!input.ok) return input.result;
        return toResult(
          await setCommitmentReminder(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            commitmentId: commitmentId(input.params.commitmentId),
            enabled: input.body.enabled,
            minuteOfDay: input.body.minuteOfDay,
            // Out-of-range days are the use case's InvalidReminder, as in the season routes.
            weekdays: input.body.weekdays as SetCommitmentReminderInput["weekdays"],
          }),
          200,
          presentCommitmentReminder,
        );
      },
    },
  ];
}
