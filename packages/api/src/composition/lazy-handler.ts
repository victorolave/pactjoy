import { apiFailure } from "../errors/api-error.ts";
import { respond } from "../http/envelope.ts";
import type { Handler } from "../http/types.ts";
import type { Logger } from "./logger.ts";

/**
 * Builds the real handler on the first request and keeps it for the life of the isolate
 * (AC-R4). The build opens no connections: the unit of work connects on first use and the
 * key set is fetched on the first verification, so requests refused early never cost one.
 *
 * A failing build (typically a bad environment) answers 503 `ServiceUnavailable` without CORS
 * headers (the allowed origins are unknown) and is retried on the next request. Only the error
 * name and a truncated message are logged; the environment errors name variables, never values.
 */
export function createLazyHandler(
  build: () => Handler,
  deps: { readonly logger: Logger },
): Handler {
  let built: Handler | undefined;
  return async (request) => {
    if (built === undefined) {
      try {
        built = build();
      } catch (e) {
        deps.logger.error("composition.failed", {
          error: e instanceof Error ? { name: e.name, message: e.message } : { name: typeof e },
        });
        return respond(apiFailure("ServiceUnavailable", undefined, { "Retry-After": "5" }));
      }
    }
    return built(request);
  };
}
