import type { RequestEntryPhotoUploadResult } from "@pactjoy/app";
import { presentInstant } from "./time.ts";

export interface PhotoUploadDto {
  readonly photoId: string;
  readonly upload: {
    readonly method: "PUT";
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly expiresAt: string;
  };
  readonly attachBy: string;
}

/**
 * Explicit wire whitelist (ADR-0011): the signed request the browser may execute, and until when the
 * photo can be attached. The object key lives only inside the signed URL; the reservation's state,
 * size and bucket are not on the result and so cannot be emitted.
 */
export function presentPhotoUpload(result: RequestEntryPhotoUploadResult): PhotoUploadDto {
  return {
    photoId: result.photoId,
    upload: {
      method: "PUT",
      url: result.upload.url,
      headers: { ...result.upload.headers },
      expiresAt: presentInstant(result.upload.expiresAt),
    },
    attachBy: presentInstant(result.attachBy),
  };
}
