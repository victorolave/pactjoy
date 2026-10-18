import { describe, expect, it } from "vitest";
import { encryptPayload, importEcdhPrivateKey } from "./aes128gcm.ts";
import { fromBase64Url, toBase64Url } from "./base64url.ts";

/**
 * RFC 8291 ("Message Encryption for Web Push"), Appendix A, verbatim: the example with a fixed
 * application-server key pair and salt, so the encrypted body is byte-exact.
 * https://www.rfc-editor.org/rfc/rfc8291#appendix-A
 */
const RFC8291 = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Test-only: the user agent's side of RFC 8291 + RFC 8188, to round-trip random inputs. */
async function decrypt(
  body: Uint8Array,
  uaPrivate: CryptoKey,
  uaPublic: Uint8Array,
  auth: Uint8Array,
) {
  const salt = body.slice(0, 16);
  const idLength = body[20] as number;
  const asPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const peer = await crypto.subtle.importKey(
    "raw",
    asPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, uaPrivate, 256),
  );
  const hmac = async (key: Uint8Array, data: Uint8Array) =>
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await crypto.subtle.importKey(
          "raw",
          key as BufferSource,
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
        data as BufferSource,
      ),
    );
  const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  };
  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(
    prkKey,
    concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])),
  );
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, encoder.encode("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
  const nonce = (await hmac(prk, encoder.encode("Content-Encoding: nonce\0\x01"))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext),
  );
  expect(padded[padded.length - 1]).toBe(2);
  return decoder.decode(padded.slice(0, -1));
}

describe("encryptPayload (RFC 8291 aes128gcm)", () => {
  it("reproduces the RFC 8291 Appendix A body byte for byte", async () => {
    const asPublic = fromBase64Url(RFC8291.asPublic);
    const body = await encryptPayload({
      uaPublic: fromBase64Url(RFC8291.uaPublic),
      authSecret: fromBase64Url(RFC8291.authSecret),
      plaintext: encoder.encode(RFC8291.plaintext),
      ephemeral: {
        privateKey: await importEcdhPrivateKey(fromBase64Url(RFC8291.asPrivate), asPublic),
        publicKey: asPublic,
      },
      salt: fromBase64Url(RFC8291.salt),
    });
    expect(toBase64Url(body)).toBe(RFC8291.body);
  });

  it("the RFC user agent can decrypt the RFC body (the test-only decrypt is itself right)", async () => {
    const uaPublic = fromBase64Url(RFC8291.uaPublic);
    const plaintext = await decrypt(
      fromBase64Url(RFC8291.body),
      await importEcdhPrivateKey(fromBase64Url(RFC8291.uaPrivate), uaPublic),
      uaPublic,
      fromBase64Url(RFC8291.authSecret),
    );
    expect(plaintext).toBe(RFC8291.plaintext);
  });

  it("round-trips with a fresh ephemeral key and salt, which differ on every call", async () => {
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const message = '{"v":1,"kind":"reviewDue","params":{"seasonId":"s","periodIndex":2}}';
    const input = { uaPublic, authSecret: auth, plaintext: encoder.encode(message) };
    const first = await encryptPayload(input);
    const second = await encryptPayload(input);
    expect(toBase64Url(first.slice(0, 16))).not.toBe(toBase64Url(second.slice(0, 16)));
    expect(await decrypt(first, ua.privateKey, uaPublic, auth)).toBe(message);
    expect(await decrypt(second, ua.privateKey, uaPublic, auth)).toBe(message);
  });

  it("writes the RFC 8188 header: salt, rs = 4096, a 65-byte key id", async () => {
    const body = fromBase64Url(RFC8291.body);
    expect([...body.slice(16, 21)]).toEqual([0, 0, 16, 0, 65]);
  });

  it("rejects a malformed user-agent key or auth secret", async () => {
    const plaintext = encoder.encode("x");
    await expect(
      encryptPayload({ uaPublic: new Uint8Array(64), authSecret: new Uint8Array(16), plaintext }),
    ).rejects.toThrow(RangeError);
    await expect(
      encryptPayload({
        uaPublic: fromBase64Url(RFC8291.uaPublic),
        authSecret: new Uint8Array(15),
        plaintext,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("refuses a plaintext that does not fit one 4096-byte record", async () => {
    await expect(
      encryptPayload({
        uaPublic: fromBase64Url(RFC8291.uaPublic),
        authSecret: fromBase64Url(RFC8291.authSecret),
        plaintext: new Uint8Array(4096 - 16),
      }),
    ).rejects.toThrow(RangeError);
  });
});
