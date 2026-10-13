import {
  type EvidenceStorage,
  EvidenceStorageError,
  type EvidenceStorageErrorCode,
  type Instant,
  instant,
  type SignedRequest,
} from "@pactjoy/app";
import { presign } from "./sigv4.ts";

export interface S3EvidenceStorageOptions {
  /** Where THIS process reaches storage (HEAD, ranged GET, DELETE). Path-style base, e.g. `http://kong:8000/storage/v1/s3`. */
  readonly endpoint: string;
  /**
   * What the BROWSER reaches (presigned PUT and GET). SigV4 signs the `Host`, so it must be the host
   * the browser will really call (the https tunnel for a phone). Defaults to `endpoint`.
   */
  readonly publicEndpoint?: string;
  /**
   * `host[:port]` to SIGN server-side calls for, when it differs from the one in `endpoint`. Local
   * Supabase: Storage validates `<X-Forwarded-Host>:54321`, so `http://kong:8000/...` needs `kong:54321`.
   */
  readonly signingHost?: string;
  /** Same, for the browser URLs (`publicEndpoint`): the https tunnel `t` needs `t:54321` locally. */
  readonly publicSigningHost?: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Wall clock for the short-lived URLs of server-side calls. Defaults to `Date.now()`. */
  readonly now?: () => Instant;
}

/** Server-side calls run right after signing; a minute is plenty. */
const SERVER_CALL_TTL_SECONDS = 60;
const SERVER_CALL_TIMEOUT_MS = 15_000;

function codeForStatus(status: number): EvidenceStorageErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status >= 500) return "unavailable";
  return "rejected";
}

/**
 * {@link EvidenceStorage} over the S3 protocol (AWS S3, Cloudflare R2, SeaweedFS, MinIO, Supabase Storage's S3
 * endpoint), path-style. Every call, browser or server, is a SigV4 query-presigned URL from the
 * same signer. Failures become {@link EvidenceStorageError}: a fixed message and a code, never the
 * URL, the key or the signature, and no `cause` that could carry them.
 */
export function createS3EvidenceStorage(options: S3EvidenceStorageOptions): EvidenceStorage {
  const { region, bucket, accessKeyId, secretAccessKey } = options;
  const doFetch = options.fetch ?? fetch;
  const wallClock = options.now ?? (() => instant(Date.now()));
  const credentials = { accessKeyId, secretAccessKey };
  const base = (endpoint: string) => endpoint.replace(/\/+$/, "");
  const server = base(options.endpoint);
  const browser = base(options.publicEndpoint ?? options.endpoint);
  const serverHost = options.signingHost;
  const browserHost =
    options.publicSigningHost ?? (options.publicEndpoint ? undefined : serverHost);
  const objectUrl = (root: string, key: string) => `${root}/${bucket}/${key}`;

  const sign = (
    method: string,
    root: string,
    signedHost: string | undefined,
    key: string,
    now: Instant,
    ttlSeconds: number,
    headers?: Readonly<Record<string, string>>,
  ) =>
    presign({
      method,
      ...(signedHost ? { signedHost } : {}),
      url: objectUrl(root, key),
      region,
      credentials,
      now,
      expiresSeconds: ttlSeconds,
      ...(headers ? { headers } : {}),
    });

  /** One presigned server call. Anything but a network or HTTP failure is the caller's to judge. */
  async function call(
    method: "HEAD" | "GET" | "DELETE",
    key: string,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const url = await sign(method, server, serverHost, key, wallClock(), SERVER_CALL_TTL_SECONDS);
    try {
      return await doFetch(url, {
        method,
        ...(extraHeaders ? { headers: extraHeaders } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(SERVER_CALL_TIMEOUT_MS),
      });
    } catch {
      throw new EvidenceStorageError("unavailable");
    }
  }

  const failure = (response: Response): EvidenceStorageError =>
    new EvidenceStorageError(codeForStatus(response.status));

  return {
    async signUpload(key, object, ttlSeconds, now) {
      const url = await sign("PUT", browser, browserHost, key, now, ttlSeconds, {
        "content-length": String(object.size),
        "content-type": object.contentType,
      });
      return {
        url,
        method: "PUT",
        // content-length is signed too, but the browser derives it from the body: it is a forbidden
        // header name for fetch, so the client sends the content type only.
        headers: { "content-type": object.contentType },
        expiresAt: instant(now + ttlSeconds * 1000),
      };
    },

    async signDownloads(keys, ttlSeconds, now) {
      const entries = await Promise.all(
        keys.map(
          async (key): Promise<[string, SignedRequest]> => [
            key,
            {
              url: await sign("GET", browser, browserHost, key, now, ttlSeconds),
              method: "GET",
              headers: {},
              expiresAt: instant(now + ttlSeconds * 1000),
            },
          ],
        ),
      );
      return new Map(entries);
    },

    async stat(key) {
      const response = await call("HEAD", key);
      if (response.status === 404) return null;
      if (!response.ok) throw failure(response);
      const length = response.headers.get("content-length");
      const size = length === null || length.trim() === "" ? Number.NaN : Number(length);
      if (!Number.isSafeInteger(size) || size < 0) throw new EvidenceStorageError("rejected");
      return { size, contentType: response.headers.get("content-type") };
    },

    async readHead(key, bytes) {
      if (!Number.isInteger(bytes) || bytes < 1) {
        throw new RangeError("readHead: bytes must be a positive integer");
      }
      const response = await call("GET", key, { range: `bytes=0-${bytes - 1}` });
      if (response.status === 404 || response.status === 416) return null;
      if (!response.ok) throw failure(response);
      try {
        return new Uint8Array(await response.arrayBuffer()).slice(0, bytes);
      } catch {
        throw new EvidenceStorageError("unavailable");
      }
    },

    async delete(key) {
      const response = await call("DELETE", key);
      if (response.ok || response.status === 404) return;
      throw failure(response);
    },
  };
}
