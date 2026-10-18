/**
 * base64url without padding (RFC 4648 section 5): the encoding of every Web Push key, salt and
 * JWT segment. Pure code over `Uint8Array`, no `Buffer` and no `atob`, so it runs anywhere.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));
const PATTERN = /^[A-Za-z0-9_-]*$/;

export function isBase64Url(text: string): boolean {
  return PATTERN.test(text);
}

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += ALPHABET[c & 0x3f];
  }
  return out;
}

/** @throws {RangeError} on a character outside the url-safe alphabet (trailing `=` is ignored). */
export function fromBase64Url(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  if (!isBase64Url(clean) || clean.length % 4 === 1) {
    throw new RangeError("fromBase64Url: not base64url");
  }
  const out = new Uint8Array((clean.length * 3) >> 2);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    value = (value << 6) | (LOOKUP.get(char) as number);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >> bits) & 0xff;
    }
  }
  return out;
}
