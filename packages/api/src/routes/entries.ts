import { commitmentId, editEntry, entryId, recordEntry, seasonId } from "@pactjoy/app";
import { appErrorResult } from "../errors/status-map.ts";
import { presentEditEntryResult, presentRecordEntryResult } from "../presenters/entry.ts";
import { entryValue } from "../validation/entry.ts";
import { forDate, uuid } from "../validation/formats.ts";
import { nullable, object, optional, string } from "../validation/schema.ts";
import { type ApiDeps, type Route, validate } from "./support.ts";

const seasonParams = object({ seasonId: uuid });
// The idempotency key lives in the body (never the query or a header, UE-E-S16). The member is
// never part of the body: it comes from the circle, so a `memberId` field is an unknownField.
const recordBody = object({
  commitmentId: uuid,
  forDate: optional(forDate),
  value: entryValue,
  note: nullable(optional(string)),
  clientRequestId: string,
});

const entryParams = object({ entryId: uuid });
// Both fields are required (`note: null` clears it), so nothing is silently kept or dropped. The
// day, the key and the member are not editable: any other field is an unknownField.
const editBody = object({ value: entryValue, note: nullable(string) });

export function entryRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: "/seasons/:seasonId/entries",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: recordBody });
        if (!input.ok) return input.result;
        const result = await recordEntry(deps, ctx.actor, {
          ...input.body,
          seasonId: seasonId(input.params.seasonId),
          commitmentId: commitmentId(input.body.commitmentId),
        });
        if (!result.ok) return appErrorResult(result.error);
        // 201 for a new entry, 200 for an idempotent replay (T1). The viewer is the member the use
        // case resolved in its own transaction, never `entry.memberId` and never a second read.
        return {
          status: result.value.replayed ? 200 : 201,
          data: presentRecordEntryResult(result.value, result.value.memberId),
        };
      },
    },
    {
      method: "PUT",
      pattern: "/entries/:entryId",
      async handle(ctx) {
        const input = validate(ctx, { params: entryParams, body: editBody });
        if (!input.ok) return input.result;
        const result = await editEntry(deps, ctx.actor, {
          ...input.body,
          entryId: entryId(input.params.entryId),
        });
        if (!result.ok) return appErrorResult(result.error);
        return { status: 200, data: presentEditEntryResult(result.value, result.value.memberId) };
      },
    },
  ];
}
