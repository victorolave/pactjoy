/**
 * The photo-specific failures (ADR-0016). Seven kinds, no more: the API maps them to statuses
 * (422 / 404 / 409) and the web client switches on them.
 */

/** Why a reservation or a stored object was refused. */
export type InvalidPhotoReason =
  /** The declared size is not a positive integer. */
  | "empty"
  | "tooLarge"
  /** The declared content type is not `image/jpeg`. */
  | "type"
  /** The stored object does not start with a JPEG signature (or is not `image/jpeg`). */
  | "notJpeg"
  /** The stored object is not the size that was reserved. */
  | "sizeMismatch";

export type PhotoError =
  | { readonly kind: "InvalidPhoto"; readonly reason: InvalidPhotoReason }
  /** `missed` ("Hoy no salió") never carries a photo. */
  | { readonly kind: "PhotoNotAllowedOnMissed" }
  /** Unknown id, somebody else's, or reserved for another commitment. */
  | { readonly kind: "PhotoNotFound" }
  /** The browser has not PUT the object yet. */
  | { readonly kind: "PhotoNotUploaded" }
  | { readonly kind: "PhotoUploadExpired" }
  /** Already attached to an Entry, or released. */
  | { readonly kind: "PhotoNotAvailable" }
  | { readonly kind: "TooManyPhotoUploads" };
