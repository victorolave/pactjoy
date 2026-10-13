import {
  type EvidenceStorage,
  EvidenceStorageError,
  type EvidenceStorageErrorCode,
  type SignedRequest,
} from "../ports/evidence-storage.ts";
import type { Clock } from "../time/clock.port.ts";
import { type Instant, instant } from "../time/instant.ts";

const ORIGIN = "memory://entry-photos/";

type Operation = "signUpload" | "signDownloads" | "stat" | "readHead" | "delete";

export interface InMemoryEvidenceStorage extends EvidenceStorage {
  /**
   * Plays the browser: executes a signed PUT. Refuses (like a real storage) a body whose length or
   * content type differs from what was signed, and a URL past its expiry on the app `Clock`.
   * `headers` replaces the signed ones, to simulate a client that sends something else.
   */
  upload(
    request: SignedRequest,
    bytes: Uint8Array,
    headers?: Readonly<Record<string, string>>,
  ): "accepted" | "rejected";
  /** Plays the browser: executes a signed GET; `null` if expired or the object is missing. */
  download(request: SignedRequest): Uint8Array | null;
  /** Keys of the stored objects, for assertions. */
  keys(): readonly string[];
  /** Makes the next call to `operation` throw an {@link EvidenceStorageError}. */
  failNext(operation: Operation, code: EvidenceStorageErrorCode): void;
}

export interface InMemoryEvidenceStorageOptions {
  readonly clock: Clock;
}

interface Stored {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

interface ParsedUrl {
  readonly key: string;
  readonly exp: number;
  readonly len: number | null;
  readonly contentType: string | null;
}

function parse(url: string): ParsedUrl | null {
  if (!url.startsWith(ORIGIN)) return null;
  const [path = "", query = ""] = url.slice(ORIGIN.length).split("?");
  const params = new Map(
    query.split("&").map((pair): [string, string] => {
      const [name = "", value = ""] = pair.split("=");
      return [name, decodeURIComponent(value)];
    }),
  );
  const len = params.get("len");
  return {
    key: path,
    exp: Number(params.get("exp")),
    len: len === undefined ? null : Number(len),
    contentType: params.get("ctype") ?? null,
  };
}

/**
 * Deterministic {@link EvidenceStorage} for tests (ADR-0016). URLs look like
 * `memory://entry-photos/<key>?exp&len&ctype`; expiry follows the injected app `Clock`, never the
 * wall clock.
 */
export function createInMemoryEvidenceStorage(
  options: InMemoryEvidenceStorageOptions,
): InMemoryEvidenceStorage {
  const objects = new Map<string, Stored>();
  const failures = new Map<Operation, EvidenceStorageErrorCode>();

  const guard = (operation: Operation): void => {
    const code = failures.get(operation);
    if (code === undefined) return;
    failures.delete(operation);
    throw new EvidenceStorageError(code);
  };

  const expired = (exp: number): boolean => options.clock.now() >= exp;

  return {
    async signUpload(key, object, ttlSeconds, now) {
      guard("signUpload");
      const expiresAt: Instant = instant(now + ttlSeconds * 1000);
      const query = `exp=${expiresAt}&len=${object.size}&ctype=${encodeURIComponent(object.contentType)}`;
      return {
        url: `${ORIGIN}${key}?${query}`,
        method: "PUT",
        headers: { "content-type": object.contentType },
        expiresAt,
      };
    },

    async signDownloads(keys, ttlSeconds, now) {
      guard("signDownloads");
      const expiresAt: Instant = instant(now + ttlSeconds * 1000);
      return new Map(
        keys.map((key): [string, SignedRequest] => [
          key,
          { url: `${ORIGIN}${key}?exp=${expiresAt}`, method: "GET", headers: {}, expiresAt },
        ]),
      );
    },

    async stat(key) {
      guard("stat");
      const stored = objects.get(key);
      return stored ? { size: stored.bytes.length, contentType: stored.contentType } : null;
    },

    async readHead(key, bytes) {
      guard("readHead");
      const stored = objects.get(key);
      if (!stored || stored.bytes.length === 0) return null;
      return stored.bytes.slice(0, bytes);
    },

    async delete(key) {
      guard("delete");
      objects.delete(key);
    },

    upload(request, bytes, headers) {
      const parsed = parse(request.url);
      if (!parsed || request.method !== "PUT" || expired(parsed.exp)) return "rejected";
      const sent = (headers ?? request.headers)["content-type"];
      if (parsed.len !== bytes.length || parsed.contentType !== sent) return "rejected";
      objects.set(parsed.key, { bytes: bytes.slice(), contentType: sent });
      return "accepted";
    },

    download(request) {
      const parsed = parse(request.url);
      if (!parsed || request.method !== "GET" || expired(parsed.exp)) return null;
      return objects.get(parsed.key)?.bytes.slice() ?? null;
    },

    keys() {
      return [...objects.keys()];
    },

    failNext(operation, code) {
      failures.set(operation, code);
    },
  };
}
