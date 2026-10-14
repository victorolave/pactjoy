/** The signed request the API handed out; nothing else is ever sent with the bytes. */
export interface SignedUpload {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * `ok`: the storage took it. `rejected`: it refused the bytes or the signature (expired, wrong size
 * or type), so the same slot cannot work again. `failed`: the network or the storage was not
 * reachable; a new attempt may work.
 */
export type UploadOutcome = "ok" | "rejected" | "failed";

/** Sends the bytes straight to the storage, a foreign origin: no API credentials go along. */
export interface PhotoUploader {
  put(upload: SignedUpload, blob: Blob, signal?: AbortSignal): Promise<UploadOutcome>;
}
