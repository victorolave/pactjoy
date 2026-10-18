/**
 * Prints a fresh VAPID key pair (ADR-0017) in the format `API_PUSH_VAPID_*` expects:
 *
 *   pnpm --filter @pactjoy/push generate-vapid-keys
 *
 * The output goes to stdout only; nothing is written to disk. Put the private key in the secret
 * store of the environment (never in the repository); the public key is served to the web client
 * by `GET /me/push-config`. Rotating the pair makes every device re-subscribe on its next start.
 */
import { toBase64Url } from "../src/base64url.ts";

const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;

console.log(`API_PUSH_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`API_PUSH_VAPID_PRIVATE_KEY=${privateKey}`);
