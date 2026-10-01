import { err, ok, type UserId } from "@pactjoy/app";
import type { TokenVerifier } from "../auth/token-verifier.port.ts";

/** Test double: tokens map to users; anything else is an invalid signature. */
export function createFakeTokenVerifier(tokens: Readonly<Record<string, UserId>>): TokenVerifier {
  return {
    async verify(token) {
      const user = Object.hasOwn(tokens, token) ? tokens[token] : undefined;
      return user === undefined ? err({ reason: "invalidSignature" }) : ok({ userId: user });
    },
  };
}
