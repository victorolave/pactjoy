import type { Result, UserId } from "@pactjoy/app";

export interface VerifiedToken {
  readonly userId: UserId;
}

/** Why a token was refused. Logged by the guard, never returned to the client (no oracle). */
export interface TokenRejection {
  readonly reason:
    | "malformed"
    | "expired"
    | "notYetValid"
    | "invalidSignature"
    | "unsupportedAlgorithm"
    | "wrongIssuer"
    | "wrongAudience"
    | "notAuthenticated"
    | "invalidSubject"
    | "keysUnavailable";
}

/** Port: any JWT library or identity provider sits behind this (ADR-0011). */
export interface TokenVerifier {
  verify(token: string): Promise<Result<VerifiedToken, TokenRejection>>;
}
