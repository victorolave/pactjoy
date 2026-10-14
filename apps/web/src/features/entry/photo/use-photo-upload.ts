import { useCallback, useEffect, useReducer, useRef } from "react";
import { usePactJoyApi } from "../../../context/api-context.tsx";
import { usePhotoTools } from "../../../context/photo-context.tsx";
import { toUiError } from "../../../shared/ui-error.ts";
import { INITIAL_PHOTO, type PhotoUploadState, photoUploadReducer } from "./photo-upload.ts";

export interface PhotoUpload {
  readonly state: PhotoUploadState;
  /** Prepares the file and uploads it as soon as it is picked. */
  pick(file: Blob): void;
  /** Reserves a new slot and sends the already prepared bytes again; no new pick. */
  retry(): void;
  /** Forgets the photo (the file stays on the server until the sweep; nothing was attached). */
  remove(): void;
  /** The server turned the photo down when saving the entry: offer to upload it again. */
  reject(): void;
}

const previewOf = (blob: Blob): string | null =>
  typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : null;

/**
 * One photo for one commitment's sheet (ADR-0016). The upload starts on pick, directly to the
 * storage with a signed URL; the entry later names the photo by id. Every answer is checked against
 * the run it belongs to, so a slow answer after a removal or a new pick is dropped.
 */
export function usePhotoUpload(seasonId: string, commitmentId: string): PhotoUpload {
  const api = usePactJoyApi();
  const { imageProcessor, photoUploader } = usePhotoTools();
  const [state, dispatch] = useReducer(photoUploadReducer, INITIAL_PHOTO);
  const run = useRef(0);
  const preview = useRef<string | null>(null);
  const blobRef = useRef<Blob | null>(null);

  const freePreview = useCallback(() => {
    if (preview.current !== null) URL.revokeObjectURL?.(preview.current);
    preview.current = null;
  }, []);

  useEffect(
    () => () => {
      run.current += 1;
      freePreview();
    },
    [freePreview],
  );

  const upload = useCallback(
    async (blob: Blob, mine: number) => {
      try {
        const reserved = await api.requestPhotoUpload({
          seasonId,
          commitmentId,
          byteSize: blob.size,
        });
        if (run.current !== mine) return;
        const outcome = await photoUploader.put(
          { url: reserved.upload.url, headers: reserved.upload.headers },
          blob,
        );
        if (run.current !== mine) return;
        dispatch(
          outcome === "ok"
            ? { type: "uploaded", photoId: reserved.photoId }
            : { type: "failed", cause: "retry" },
        );
      } catch (error) {
        if (run.current !== mine) return;
        const limited = toUiError(error).kind === "photoLimit";
        dispatch({ type: "failed", cause: limited ? "limit" : "retry" });
      }
    },
    [api, photoUploader, seasonId, commitmentId],
  );

  const pick = useCallback(
    (file: Blob) => {
      run.current += 1;
      const mine = run.current;
      freePreview();
      dispatch({ type: "picked" });
      void imageProcessor.prepare(file).then((result) => {
        if (run.current !== mine) return;
        if (!result.ok) {
          dispatch({ type: "unusable" });
          return;
        }
        blobRef.current = result.photo.blob;
        preview.current = previewOf(result.photo.blob);
        dispatch({ type: "prepared", blob: result.photo.blob, previewUrl: preview.current });
        void upload(result.photo.blob, mine);
      });
    },
    [imageProcessor, upload, freePreview],
  );

  const retry = useCallback(() => {
    const blob = blobRef.current;
    if (blob === null) return;
    run.current += 1;
    dispatch({ type: "retried" });
    void upload(blob, run.current);
  }, [upload]);

  const remove = useCallback(() => {
    run.current += 1;
    blobRef.current = null;
    freePreview();
    dispatch({ type: "removed" });
  }, [freePreview]);

  const reject = useCallback(() => dispatch({ type: "failed", cause: "retry" }), []);

  return { state, pick, retry, remove, reject };
}
