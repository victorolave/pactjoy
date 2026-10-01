import { err, ok, userId } from "@pactjoy/app";
import { createRemoteJWKSet, customFetch, errors, type JWTPayload, jwtVerify } from "jose";
import type { TokenRejection, TokenVerifier } from "../auth/token-verifier.port.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface JwksTokenVerifierOptions {
  readonly jwksUrl: string;
  readonly issuer: string;
  /** Test seam for the key-set request; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly cooldownMs?: number;
}

type Reason = TokenRejection["reason"];

function reasonOf(error: unknown): Reason {
  if (error instanceof errors.JWTExpired) return "expired";
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "iss") return "wrongIssuer";
    if (error.claim === "aud") return "wrongAudience";
    if (error.claim === "role") return "notAuthenticated";
    if (error.claim === "sub") return "invalidSubject";
    return "malformed";
  }
  if (error instanceof errors.JOSEAlgNotAllowed) return "unsupportedAlgorithm";
  if (
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys
  )
    return "invalidSignature";
  // Unreadable token structure; everything else came from fetching the key set.
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) return "malformed";
  return "keysUnavailable";
}

/**
 * TokenVerifier over a remote JWKS (the only file that imports jose; ADR-0011).
 * ES256/RS256 only, issuer + audience `authenticated`, role `authenticated`,
 * non-anonymous, subject a canonical uuid.
 */
export function createJwksTokenVerifier(options: JwksTokenVerifierOptions): TokenVerifier {
  const keys = createRemoteJWKSet(new URL(options.jwksUrl), {
    cacheMaxAge: 600_000,
    cooldownDuration: options.cooldownMs ?? 30_000,
    timeoutDuration: options.timeoutMs ?? 5_000,
    ...(options.fetch ? { [customFetch]: options.fetch as never } : {}),
  });

  return {
    async verify(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          algorithms: ["ES256", "RS256"],
          issuer: options.issuer,
          audience: "authenticated",
          requiredClaims: ["sub", "exp", "role"],
          clockTolerance: 30,
        }));
      } catch (error) {
        return err({ reason: reasonOf(error) });
      }
      if (payload.role !== "authenticated" || payload.is_anonymous === true)
        return err({ reason: "notAuthenticated" });
      if (typeof payload.sub !== "string" || !UUID.test(payload.sub))
        return err({ reason: "invalidSubject" });
      return ok({ userId: userId(payload.sub) });
    },
  };
}
