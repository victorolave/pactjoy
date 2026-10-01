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

/** Raised only when the key set cannot be fetched or read; the sole source of a 503. */
class KeysUnavailable extends Error {}

function reasonOf(error: unknown): Reason {
  if (error instanceof errors.JWTExpired) return "expired";
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "iss") return "wrongIssuer";
    if (error.claim === "aud") return "wrongAudience";
    if (error.claim === "role") return "notAuthenticated";
    if (error.claim === "sub") return "invalidSubject";
    if (error.claim === "nbf") return "notYetValid";
    return "malformed";
  }
  if (error instanceof errors.JOSEAlgNotAllowed) return "unsupportedAlgorithm";
  if (
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys
  )
    return "invalidSignature";
  if (error instanceof KeysUnavailable) return "keysUnavailable";
  if (error instanceof errors.JOSEError) return "malformed"; // the token itself is bad
  throw error; // not jose: a bug or environment fault, a 500 rather than a 401
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

  // Only a failed key fetch is an outage; a token naming no (or several) keys is the caller's fault.
  // Object.assign freezes the key set's getters here; jwtVerify only calls the function.
  const getKey: typeof keys = Object.assign(async (...args: Parameters<typeof keys>) => {
    try {
      return await keys(...args);
    } catch (error) {
      if (
        error instanceof errors.JWKSNoMatchingKey ||
        error instanceof errors.JWKSMultipleMatchingKeys
      )
        throw error;
      throw new KeysUnavailable("key set unavailable", { cause: error });
    }
  }, keys);

  return {
    async verify(token) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, getKey, {
          algorithms: ["ES256", "RS256"],
          issuer: options.issuer,
          audience: "authenticated",
          requiredClaims: ["sub", "exp", "role"],
          clockTolerance: 30,
        }));
      } catch (error) {
        return err({ reason: reasonOf(error) });
      }
      if (
        payload.role !== "authenticated" ||
        (payload.is_anonymous !== undefined && payload.is_anonymous !== false)
      )
        return err({ reason: "notAuthenticated" });
      if (typeof payload.sub !== "string" || !UUID.test(payload.sub))
        return err({ reason: "invalidSubject" });
      return ok({ userId: userId(payload.sub) });
    },
  };
}
