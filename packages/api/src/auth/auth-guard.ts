import type { Actor } from "@pactjoy/app";
import type { Logger } from "../composition/logger.ts";
import type { Authenticate } from "../http/pipeline.ts";
import type { TokenRejection, TokenVerifier } from "./token-verifier.port.ts";

const MAX_TOKEN_LENGTH = 8 * 1024;
const BEARER = /^bearer +(\S+)$/i;

const UNAUTHORIZED = {
  ok: false,
  result: { status: 401, error: { code: "Unauthorized", message: "Unauthorized" } },
  headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' },
} as const;

const UNAVAILABLE = {
  ok: false,
  result: { status: 503, error: { code: "ServiceUnavailable", message: "ServiceUnavailable" } },
  headers: { "Retry-After": "5" },
} as const;

/**
 * `Authorization: Bearer <token>` -> Actor. Every refusal is the same 401 body
 * and headers whatever the reason (no oracle); the reason goes to the logger,
 * the token never does. Only an unreachable key set is a 503.
 */
export function createAuthGuard(deps: {
  readonly verifier: TokenVerifier;
  readonly logger: Logger;
}): Authenticate<Actor> {
  const reject = (reason: TokenRejection["reason"]) => {
    deps.logger.warn("auth.rejected", { reason });
    return reason === "keysUnavailable" ? UNAVAILABLE : UNAUTHORIZED;
  };

  return async (request) => {
    const token = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
    if (token === undefined || token.length > MAX_TOKEN_LENGTH) return reject("malformed");
    const verified = await deps.verifier.verify(token);
    if (!verified.ok) return reject(verified.error.reason);
    return { ok: true, actor: { userId: verified.value.userId } };
  };
}
