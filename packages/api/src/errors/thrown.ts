import { ConcurrencyConflict, InviteCodeGenerationFailed } from "@pactjoy/app";
import type { Logger } from "../composition/logger.ts";
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
 *
 * `isUnavailable` is injected by the composition root and decides which throws mean "the
 * database is down" (503). It must match connectivity failures only, never a RangeError or
 * other invariant violation: those are bugs and must stay a 500.
 */
export function createThrownMapper(
  isUnavailable?: (e: unknown) => boolean,
  logger?: Logger,
): OnError {
  /** Server-side only: the response never carries any of this. The logger scrubs secrets. */
  const record = (e: unknown, requestId: string) => {
    try {
      const code = e instanceof Error ? (e as { code?: unknown }).code : undefined;
      logger?.error("request.failed", {
        requestId,
        error: {
          name: e instanceof Error ? e.name : typeof e,
          ...(typeof code === "string" ? { code } : {}),
          // A coded error (pg SQLSTATE, driver code) may echo user input in its message.
          ...(e instanceof Error && typeof code !== "string" ? { message: e.message } : {}),
        },
      });
    } catch {
      // Logging must never change the answer.
    }
  };
  return (e, { requestId }) => {
    if (is(e, ConcurrencyConflict, "ConcurrencyConflict")) return apiFailure("ConcurrencyConflict");
    if (is(e, InviteCodeGenerationFailed, "InviteCodeGenerationFailed")) {
      record(e, requestId);
      return apiFailure("InviteCodeGenerationFailed", { requestId });
    }
    if (safe(isUnavailable, e)) {
      record(e, requestId);
      return apiFailure("ServiceUnavailable", undefined, { "Retry-After": "5" });
    }
    record(e, requestId);
    return apiFailure("Internal", { requestId });
  };
}
