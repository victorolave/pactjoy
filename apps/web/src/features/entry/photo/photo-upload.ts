/** Where the photo of an entry sheet is: from the pick to an id the entry can carry (ADR-0016). */
export type PhotoUploadState =
  | { readonly status: "idle" }
  | { readonly status: "preparing" }
  | { readonly status: "uploading"; readonly blob: Blob; readonly previewUrl: string | null }
  | {
      readonly status: "ready";
      readonly blob: Blob;
      readonly previewUrl: string | null;
      readonly photoId: string;
    }
  | {
      readonly status: "failed";
      readonly blob: Blob;
      readonly previewUrl: string | null;
      /** `limit`: too many slots are open, waiting is the fix. `retry`: trying again may work. */
      readonly cause: "retry" | "limit";
    }
  /** It cannot be decoded, or it is still too large after resizing. */
  | { readonly status: "unusable" };

export type PhotoUploadAction =
  | { readonly type: "picked" }
  | { readonly type: "prepared"; readonly blob: Blob; readonly previewUrl: string | null }
  | { readonly type: "unusable" }
  | { readonly type: "uploaded"; readonly photoId: string }
  | { readonly type: "failed"; readonly cause: "retry" | "limit" }
  | { readonly type: "retried" }
  | { readonly type: "removed" };

export const INITIAL_PHOTO: PhotoUploadState = { status: "idle" };

export function photoUploadReducer(
  state: PhotoUploadState,
  action: PhotoUploadAction,
): PhotoUploadState {
  switch (action.type) {
    case "picked":
      return { status: "preparing" };
    case "prepared":
      return state.status === "preparing"
        ? { status: "uploading", blob: action.blob, previewUrl: action.previewUrl }
        : state;
    case "unusable":
      return state.status === "preparing" ? { status: "unusable" } : state;
    case "uploaded":
      return state.status === "uploading"
        ? {
            status: "ready",
            blob: state.blob,
            previewUrl: state.previewUrl,
            photoId: action.photoId,
          }
        : state;
    case "failed":
      return state.status === "uploading" || state.status === "ready"
        ? { status: "failed", blob: state.blob, previewUrl: state.previewUrl, cause: action.cause }
        : state;
    case "retried":
      return state.status === "failed"
        ? { status: "uploading", blob: state.blob, previewUrl: state.previewUrl }
        : state;
    case "removed":
      return INITIAL_PHOTO;
  }
}

/**
 * What the request carries for the photo: the new id, `null` to remove the old one, or `undefined`
 * to leave the field out (an edit keeps the photo it has). A failed or unusable pick never blocks
 * saving: the entry just goes without it (REQ-W9).
 */
export function photoIdToSend(
  state: PhotoUploadState,
  removedExisting: boolean,
): string | null | undefined {
  if (state.status === "ready") return state.photoId;
  return removedExisting ? null : undefined;
}

/** The sheet cannot save while bytes are being prepared or sent. */
export const isPhotoBusy = (state: PhotoUploadState): boolean =>
  state.status === "preparing" || state.status === "uploading";
