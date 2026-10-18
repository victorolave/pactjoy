import { toBase64Url } from "./base64url.ts";

/**
 * Web Push message encryption, RFC 8291 section 3.4, in the aes128gcm content coding of RFC 8188,
 * on WebCrypto only (`crypto.subtle`): no `node:` import and no library, so it runs on Node and
 * Deno (ADR-0017). One record, no padding: the payloads PactJoy sends are a few hundred bytes.
 * https://www.rfc-editor.org/rfc/rfc8291 https://www.rfc-editor.org/rfc/rfc8188
 */

/** RFC 8188 record size we declare; the whole message must fit one record. */
const RECORD_SIZE = 4096;
/** Header: salt (16) + rs (4) + idlen (1) + key id (65, the uncompressed P-256 point). */
const HEADER_LENGTH = 16 + 4 + 1 + 65;
const TAG_LENGTH = 16;

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data as BufferSource));
}

/** HKDF-Expand for a single block (RFC 5869): every length here is at most 32 bytes. */
async function expand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  return (await hmacSha256(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

function assertPoint(point: Uint8Array, name: string): void {
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new RangeError(`${name} must be an uncompressed P-256 point (65 bytes)`);
  }
}

/** Imports a P-256 private key for ECDH from its raw `d` and its public point. */
export async function importEcdhPrivateKey(
  d: Uint8Array,
  publicPoint: Uint8Array,
): Promise<CryptoKey> {
  assertPoint(publicPoint, "publicPoint");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: toBase64Url(d),
      x: toBase64Url(publicPoint.slice(1, 33)),
      y: toBase64Url(publicPoint.slice(33, 65)),
      ext: false,
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

export interface EncryptInput {
  /** The subscription's `p256dh`: the user agent's public key. */
  readonly uaPublic: Uint8Array;
  /** The subscription's `auth`: 16 bytes. */
  readonly authSecret: Uint8Array;
  readonly plaintext: Uint8Array;
  /** Test seam: the application server's key pair for this message; fresh by default. */
  readonly ephemeral?: { readonly privateKey: CryptoKey; readonly publicKey: Uint8Array };
  /** Test seam: the 16-byte salt; random by default. */
  readonly salt?: Uint8Array;
}

/**
 * The full aes128gcm body for one push message: the RFC 8188 header (salt, rs, the application
 * server's public key as key id) followed by the single encrypted record.
 * @throws {RangeError} on a malformed key or secret, or a plaintext that does not fit one record.
 */
export async function encryptPayload(input: EncryptInput): Promise<Uint8Array> {
  assertPoint(input.uaPublic, "uaPublic");
  if (input.authSecret.length !== 16) throw new RangeError("authSecret must be 16 bytes");
  if (input.plaintext.length + 1 + TAG_LENGTH > RECORD_SIZE - HEADER_LENGTH) {
    throw new RangeError("plaintext does not fit one aes128gcm record");
  }

  const ephemeral =
    input.ephemeral ??
    (await (async () => {
      const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
        "deriveBits",
      ])) as CryptoKeyPair;
      return {
        privateKey: pair.privateKey,
        publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
      };
    })());
  const salt = input.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await crypto.subtle.importKey(
    "raw",
    input.uaPublic as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256),
  );

  // RFC 8291 section 3.4: the auth secret mixes into the ECDH secret to give the IKM.
  const prkKey = await hmacSha256(input.authSecret, ecdhSecret);
  const keyInfo = concat(encoder.encode("WebPush: info\0"), input.uaPublic, ephemeral.publicKey);
  const ikm = await expand(prkKey, keyInfo, 32);

  // RFC 8188 section 2.2: the content encryption key and nonce, from the salt.
  const prk = await hmacSha256(salt, ikm);
  const cek = await expand(prk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await expand(prk, encoder.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, [
    "encrypt",
  ]);
  // The last (and only) record ends with the 0x02 delimiter and no padding.
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      concat(input.plaintext, new Uint8Array([2])) as BufferSource,
    ),
  );

  const header = new Uint8Array(HEADER_LENGTH);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = 65;
  header.set(ephemeral.publicKey, 21);
  return concat(header, record);
}
