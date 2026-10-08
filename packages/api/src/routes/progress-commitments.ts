import { commitmentId, commitmentProgress, seasonId } from "@pactjoy/app";
import { presentCommitmentProgress } from "../presenters/progress-commitment.ts";
import { uuid } from "../validation/formats.ts";
import { object } from "../validation/schema.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const params = object({ seasonId: uuid, commitmentId: uuid });
const body = object({});

export function commitmentProgressRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/seasons/:seasonId/commitments/:commitmentId/progress",
      async handle(ctx) {
        const input = validate(ctx, { params, body, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await commitmentProgress(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            commitmentId: commitmentId(input.params.commitmentId),
          }),
          200,
          presentCommitmentProgress,
        );
      },
    },
  ];
}
