import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "./base64url.ts";
import { importVapidKeys, vapidAuthorization } from "./vapid.ts";

const decoder = new TextDecoder();
const NOW = 1_791_987_120_000;

async function generateKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { pair, publicKey: toBase64Url(publicRaw), privateKey: jwk.d as string };
}

describe("vapidAuthorization (RFC 8292)", () => {
  it("builds `vapid t=<jwt>, k=<public key>` with a JWT any verifier accepts", async () => {
    const keys = await generateKeys();
    const header = await vapidAuthorization({
      audience: "https://web.push.apple.com",
      subject: "mailto:ops@example.com",
      keys: await importVapidKeys(keys.publicKey, keys.privateKey),
      now: NOW,
    });
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match?.[2]).toBe(keys.publicKey);
    const [h, c, s] = (match?.[1] ?? "").split(".") as [string, string, string];
    expect(JSON.parse(decoder.decode(fromBase64Url(h)))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(decoder.decode(fromBase64Url(c)))).toEqual({
      aud: "https://web.push.apple.com",
      exp: NOW / 1000 + 12 * 3600,
      sub: "mailto:ops@example.com",
    });
    const signature = fromBase64Url(s);
    expect(signature).toHaveLength(64);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.pair.publicKey,
      signature as BufferSource,
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(valid).toBe(true);
  });

  it("never asks for more than 24 hours (RFC 8292 section 2)", async () => {
    const keys = await generateKeys();
    await expect(
      vapidAuthorization({
        audience: "https://fcm.googleapis.com",
        subject: "mailto:ops@example.com",
        keys: await importVapidKeys(keys.publicKey, keys.privateKey),
        now: NOW,
        ttlSeconds: 24 * 3600 + 1,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects keys that are not a P-256 pair in base64url", async () => {
    const keys = await generateKeys();
    await expect(importVapidKeys("not-a-key", keys.privateKey)).rejects.toThrow(RangeError);
    await expect(importVapidKeys(keys.publicKey, "short")).rejects.toThrow(RangeError);
  });

  it("rejects a public key that does not match the private one", async () => {
    const a = await generateKeys();
    const b = await generateKeys();
    await expect(importVapidKeys(a.publicKey, b.privateKey)).rejects.toThrow();
  });
});
