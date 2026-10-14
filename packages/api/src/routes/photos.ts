import { commitmentId, requestEntryPhotoUpload, seasonId } from "@pactjoy/app";
import { appErrorResult } from "../errors/status-map.ts";
import { presentPhotoUpload } from "../presenters/photo.ts";
import { uuid } from "../validation/formats.ts";
import { integer, object, string } from "../validation/schema.ts";
import { type ApiDeps, type Route, validate } from "./support.ts";

const params = object({ seasonId: uuid, commitmentId: uuid });
// The client declares what it will upload; the signature pins both. The member, the key and the
// bucket are never part of the body: any other field is an unknownField.
const body = object({ byteSize: integer({ min: 1 }), contentType: string });

export function photoRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: "/seasons/:seasonId/commitments/:commitmentId/photos",
      async handle(ctx) {
        const input = validate(ctx, { params, body });
        if (!input.ok) return input.result;
        const result = await requestEntryPhotoUpload(deps, ctx.actor, {
          seasonId: seasonId(input.params.seasonId),
          commitmentId: commitmentId(input.params.commitmentId),
          byteSize: input.body.byteSize,
          contentType: input.body.contentType,
        });
        if (!result.ok) return appErrorResult(result.error);
        return { status: 201, data: presentPhotoUpload(result.value) };
      },
    },
  ];
}
