import { ConcurrencyConflict, InviteCodeGenerationFailed } from "@pactjoy/app";
import type { OnError } from "../http/pipeline.ts";
import { apiFailure } from "./api-error.ts";

/** Class OR name: a second copy of the app module (as under Deno) breaks `instanceof`. */
const is = (e: unknown, cls: new () => Error, name: string): boolean =>
  e instanceof cls || (e instanceof Error && e.name === name);

const safe = (predicate: ((e: unknown) => boolean) | undefined, e: unknown): boolean => {
  try {
    return predicate?.(e) === true;
  } catch {
    return false;
  }
};

/**
 * The pipeline's `onError` seam. Nothing internal reaches the client: unknown errors are a
 * 500 `Internal` carrying only the request id.
 */
export function createThrownMapper(isUnavailable?: (e: unknown) => boolean): OnError {
  return (e, { requestId }) => {
    if (is(e, ConcurrencyConflict, "ConcurrencyConflict")) return apiFailure("ConcurrencyConflict");
    if (is(e, InviteCodeGenerationFailed, "InviteCodeGenerationFailed")) {
      return apiFailure("InviteCodeGenerationFailed");
    }
    if (safe(isUnavailable, e))
      return apiFailure("ServiceUnavailable", undefined, { "Retry-After": "5" });
    return apiFailure("Internal", { requestId });
  };
}
