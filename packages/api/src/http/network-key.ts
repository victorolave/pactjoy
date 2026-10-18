const KEY_BYTES = 16;

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * Keys a client network for storage (ADR-0020): HMAC-SHA256 under the server secret
 * `API_RATE_LIMIT_KEY`, truncated to 128 bits, base64url. The address itself is never stored or
 * logged; and because the hash is keyed, a dump of the counters cannot be reversed by hashing the
 * whole IPv4 space. WebCrypto only, so it runs on Node and Deno alike.
 */
export function createNetworkKeyer(secret: string): (network: string) => Promise<string> {
  let key: Promise<CryptoKey> | undefined;
  return async (network) => {
    key ??= crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", await key, new TextEncoder().encode(network));
    return base64url(new Uint8Array(mac).subarray(0, KEY_BYTES));
  };
}
