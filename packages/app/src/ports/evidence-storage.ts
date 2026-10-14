import type { Instant } from "../time/instant.ts";

/**
 * Evidence storage port (ADR-0016): where the bytes of an Entry photo live. The app owns the
 * object keys (see `entry-photo/object-key.ts`); an adapter only turns a key into signed
 * requests and executes the few server-side calls the use cases need. No vendor type, SDK or
 * URL convention appears here (CLAUDE.md, high decoupling).
 */

/** A request the browser can execute directly, with nothing but what is listed here. */
export interface SignedRequest {
  readonly url: string;
  readonly method: "PUT" | "GET";
  /** Headers that are part of the signature: the client MUST send them as they are, and no others. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Instant;
}

/** What the server learns about a stored object without downloading it. */
export interface StoredObject {
  readonly size: number;
  readonly contentType: string | null;
}

export interface EvidenceStorage {
  /**
   * Signs ONE direct upload of exactly `object.size` bytes of `object.contentType` (the signature
   * pins both). Valid for `ttlSeconds` from `now`; `now` comes from the app `Clock`, not from the
   * adapter's own wall clock. Pure computation, no network.
   */
  signUpload(
    key: string,
    object: { readonly size: number; readonly contentType: "image/jpeg" },
    ttlSeconds: number,
    now: Instant,
  ): Promise<SignedRequest>;

  /** Signs GET URLs for `keys`. Pure computation, no network: unknown keys still get a URL. */
  signDownloads(
    keys: readonly string[],
    ttlSeconds: number,
    now: Instant,
  ): Promise<ReadonlyMap<string, SignedRequest>>;

  /** Size and content type of the stored object; `null` when it does not exist. */
  stat(key: string): Promise<StoredObject | null>;

  /**
   * The first `bytes` bytes of the object (fewer if it is shorter); `null` when the object does not
   * exist or is empty.
   */
  readHead(key: string, bytes: number): Promise<Uint8Array | null>;

  /** Deletes the object. Idempotent: a missing object is not an error. */
  delete(key: string): Promise<void>;
}

/** Why a storage call failed, without saying anything about the request. */
export type EvidenceStorageErrorCode = "unavailable" | "rejected" | "unauthorized";

/**
 * Thrown by an adapter for infrastructure failures (ADR-0008, D3). The message is fixed and never
 * contains a URL, an object key or a signature: loggers print `{ name, code }` only (ADR-0011).
 */
export class EvidenceStorageError extends Error {
  readonly code: EvidenceStorageErrorCode;

  constructor(code: EvidenceStorageErrorCode) {
    super(`Evidence storage failed: ${code}`);
    this.name = "EvidenceStorageError";
    this.code = code;
  }
}
