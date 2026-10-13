import { encodePath, encodeRfc3986 } from "./uri.ts";

/**
 * AWS Signature Version 4, query-string authentication ("presigned URLs"), on WebCrypto only
 * (`crypto.subtle`, `TextEncoder`): no `node:` import and no SDK, so it runs on Node and Deno
 * (ADR-0016). The payload is always `UNSIGNED-PAYLOAD`.
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 */

export interface Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface PresignOptions {
  readonly method: string;
  /** Full URL, path-style for S3: `https://host[:port]/[prefix/]bucket/key`. */
  readonly url: string;
  readonly region: string;
  /** Defaults to `s3`. */
  readonly service?: string;
  readonly credentials: Credentials;
  /** Epoch milliseconds the signature starts at. */
  readonly now: number;
  /** 1 to 604800 (7 days), the SigV4 limits. */
  readonly expiresSeconds: number;
  /** Headers to sign besides `host` (e.g. `content-length`, `content-type`). The client must send them verbatim. */
  readonly headers?: Readonly<Record<string, string>>;
}

const encoder = new TextEncoder();
const MAX_EXPIRES_SECONDS = 604_800;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array, message: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(message)));
}

async function sha256Hex(message: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(message))));
}

/** The HMAC chain `AWS4<secret>` -> date -> region -> service -> `aws4_request`. */
export async function deriveSigningKey(
  secretAccessKey: string,
  date: string,
  region: string,
  service: string,
): Promise<Uint8Array> {
  const dateKey = await hmac(encoder.encode(`AWS4${secretAccessKey}`), date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

/** `20130524T000000Z` from epoch milliseconds. */
function amzDate(epochMs: number): string {
  return new Date(epochMs)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Returns `options.url` with the SigV4 query parameters appended. */
export async function presign(options: PresignOptions): Promise<string> {
  const { method, region, credentials, expiresSeconds } = options;
  const service = options.service ?? "s3";
  if (
    !Number.isInteger(expiresSeconds) ||
    expiresSeconds < 1 ||
    expiresSeconds > MAX_EXPIRES_SECONDS
  ) {
    throw new RangeError(`presign: expiresSeconds must be an integer in 1..${MAX_EXPIRES_SECONDS}`);
  }

  const url = new URL(options.url);
  const stamp = amzDate(options.now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;

  const signed = new Map<string, string>([["host", url.host]]);
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    signed.set(name.toLowerCase(), value.trim().replace(/\s+/g, " "));
  }
  const names = [...signed.keys()].sort();
  const canonicalHeaders = names.map((name) => `${name}:${signed.get(name)}\n`).join("");
  const signedHeaders = names.join(";");

  const query: Array<[string, string]> = [...url.searchParams.entries()];
  query.push(
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  );
  const canonicalQuery = query
    .map(([name, value]): [string, string] => [encodeRfc3986(name), encodeRfc3986(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");

  const path = encodePath(url.pathname);
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, await sha256Hex(canonicalRequest)].join(
    "\n",
  );
  const signingKey = await deriveSigningKey(credentials.secretAccessKey, date, region, service);
  const signature = toHex(await hmac(signingKey, stringToSign));

  return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
