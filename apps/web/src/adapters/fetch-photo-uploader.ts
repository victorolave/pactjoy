import type { PhotoUploader, SignedUpload, UploadOutcome } from "../ports/photo-uploader.ts";

/**
 * Headers the browser owns or that carry the user's identity. The signature covers the content type
 * only; the length comes from the body. Authorization and cookies must never reach the storage
 * origin, so they are dropped here even if a caller handed them in.
 */
const NEVER_SENT = new Set(["authorization", "cookie", "proxy-authorization", "content-length"]);

/** PUTs the bytes to the presigned URL with the browser's fetch (handed in by the composition root). */
export class FetchPhotoUploader implements PhotoUploader {
  readonly #fetch: typeof fetch;

  constructor(fetchFn: typeof fetch) {
    this.#fetch = fetchFn;
  }

  async put(upload: SignedUpload, blob: Blob, signal?: AbortSignal): Promise<UploadOutcome> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(upload.headers)) {
      if (!NEVER_SENT.has(name.toLowerCase())) headers.set(name, value);
    }
    try {
      const response = await this.#fetch(upload.url, {
        method: "PUT",
        headers,
        body: blob,
        credentials: "omit",
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.ok) return "ok";
      // 4xx: the storage refused this slot (signature expired, size or type not as signed).
      return response.status >= 400 && response.status < 500 ? "rejected" : "failed";
    } catch {
      return "failed";
    }
  }
}
