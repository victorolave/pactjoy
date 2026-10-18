import { fromBase64Url, isBase64Url, toBase64Url } from "./base64url.ts";

/**
 * VAPID (RFC 8292): the application server proves who it is with an ES256 JWT per push service
 * origin. WebCrypto ECDSA over P-256 with SHA-256 already returns the raw `r || s` signature that
 * JWS ES256 expects (RFC 7518 section 3.4), so no DER conversion is needed.
 */

export interface VapidKeys {
  /** The uncompressed public point, base64url (87 characters). */
  readonly publicKey: string;
  readonly signingKey: CryptoKey;
}

const encoder = new TextEncoder();
const MAX_TTL_SECONDS = 24 * 3600;
const DEFAULT_TTL_SECONDS = 12 * 3600;

/**
 * Imports the configured VAPID pair: `publicKey` is the base64url uncompressed point (65 bytes),
 * `privateKey` the base64url scalar `d` (32 bytes). A private key that does not match the public
 * one is refused by the import itself.
 * @throws {RangeError} on a value of the wrong shape (the message never contains the value).
 */
export async function importVapidKeys(publicKey: string, privateKey: string): Promise<VapidKeys> {
  if (!isBase64Url(publicKey) || publicKey.length !== 87) {
    throw new RangeError("VAPID public key must be a base64url uncompressed P-256 point");
  }
  if (!isBase64Url(privateKey) || privateKey.length !== 43) {
    throw new RangeError("VAPID private key must be a base64url 32-byte scalar");
  }
  const point = fromBase64Url(publicKey);
  if (point[0] !== 0x04) {
    throw new RangeError("VAPID public key must be a base64url uncompressed P-256 point");
  }
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33, 65)),
  };
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    { ...jwk, d: privateKey, ext: false },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // Prove the pair matches: a signature by `d` must verify under the public point.
  const verifyKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const probe = encoder.encode("pactjoy-vapid-pair-check");
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, probe);
  if (
    !(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, signature, probe))
  ) {
    throw new RangeError("VAPID private key does not match the public key");
  }
  return { publicKey, signingKey };
}

export interface VapidAuthorizationInput {
  /** The push service origin, e.g. `https://web.push.apple.com`. */
  readonly audience: string;
  /** `mailto:` or `https:` contact for the push service operator. */
  readonly subject: string;
  readonly keys: VapidKeys;
  /** Epoch milliseconds (the app Clock). */
  readonly now: number;
  /** At most 24 h (RFC 8292 section 2); 12 h by default. */
  readonly ttlSeconds?: number;
}

const segment = (value: unknown) => toBase64Url(encoder.encode(JSON.stringify(value)));

/** The `Authorization` header value: `vapid t=<jwt>, k=<public key>` (RFC 8292 section 3). */
export async function vapidAuthorization(input: VapidAuthorizationInput): Promise<string> {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (ttl <= 0 || ttl > MAX_TTL_SECONDS) throw new RangeError("VAPID ttl must be 1 s to 24 h");
  const exp = (input.now - (input.now % 1000)) / 1000 + ttl;
  const unsigned = `${segment({ typ: "JWT", alg: "ES256" })}.${segment({
    aud: input.audience,
    exp,
    sub: input.subject,
  })}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      input.keys.signingKey,
      encoder.encode(unsigned),
    ),
  );
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${input.keys.publicKey}`;
}
