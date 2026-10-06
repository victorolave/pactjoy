import { previewProgress } from "@pactjoy/app";
import { measureInput } from "../validation/measure.ts";
import { array, object, string } from "../validation/schema.ts";
import { type Route, toResult, validate } from "./support.ts";

const body = object({ measure: measureInput, values: array(string, 8) });
const none = object({});

export function scoringRoutes(): Route[] {
  return [
    {
      method: "POST",
      pattern: "/scoring/preview",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body });
        if (!input.ok) return input.result;
        return toResult(previewProgress(ctx.actor, input.body), 200, (view) => ({
          rows: view.rows.map((row) => ({
            value: row.value,
            progressPercent: row.progressPercent,
          })),
        }));
      },
    },
  ];
}
