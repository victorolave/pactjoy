/** The most a photo may weigh once prepared. Mirrors the server's limit (ADR-0016): 3 MiB. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
/** The longest side after resizing; enough to read a page, small enough to upload on a phone. */
export const MAX_PHOTO_SIDE = 1600;

export interface PreparedPhoto {
  /** A JPEG with no metadata: re-encoding drops EXIF and GPS. */
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

/** `unreadable`: it cannot be decoded as an image. `tooLarge`: still above the limit after resizing. */
export type PrepareFailure = "unreadable" | "tooLarge";

export type PrepareResult =
  | { readonly ok: true; readonly photo: PreparedPhoto }
  | { readonly ok: false; readonly reason: PrepareFailure };

/** Turns whatever the member picked into the one thing the server accepts (ADR-0016). */
export interface ImageProcessor {
  prepare(file: Blob): Promise<PrepareResult>;
}
