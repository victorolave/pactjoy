import { describe, expect, it } from "vitest";
import {
  INITIAL_PHOTO,
  type PhotoUploadAction,
  type PhotoUploadState,
  photoIdToSend,
  photoUploadReducer,
} from "./photo-upload.ts";

const blob = new Blob(["jpeg"], { type: "image/jpeg" });
const run = (state: PhotoUploadState, ...actions: PhotoUploadAction[]) =>
  actions.reduce(photoUploadReducer, state);

describe("photoUploadReducer", () => {
  it("walks idle, preparing, uploading, ready", () => {
    const state = run(
      INITIAL_PHOTO,
      { type: "picked" },
      { type: "prepared", blob, previewUrl: "blob:1" },
      { type: "uploaded", photoId: "p-1" },
    );

    expect(state).toEqual({ status: "ready", blob, previewUrl: "blob:1", photoId: "p-1" });
  });

  it("an image that cannot be decoded or is too large is unusable and nothing uploads", () => {
    expect(run(INITIAL_PHOTO, { type: "picked" }, { type: "unusable" })).toEqual({
      status: "unusable",
    });
  });

  it("a failed upload keeps the prepared bytes so Reintentar needs no new pick", () => {
    const failed = run(
      INITIAL_PHOTO,
      { type: "picked" },
      { type: "prepared", blob, previewUrl: "blob:1" },
      { type: "failed", cause: "retry" },
    );
    expect(failed).toEqual({ status: "failed", blob, previewUrl: "blob:1", cause: "retry" });

    expect(run(failed, { type: "retried" })).toEqual({
      status: "uploading",
      blob,
      previewUrl: "blob:1",
    });
  });

  it("a photo the server turned down after it was ready goes back to failed", () => {
    const ready = run(
      INITIAL_PHOTO,
      { type: "picked" },
      { type: "prepared", blob, previewUrl: "blob:1" },
      { type: "uploaded", photoId: "p-1" },
    );

    expect(run(ready, { type: "failed", cause: "retry" })).toMatchObject({
      status: "failed",
      previewUrl: "blob:1",
    });
  });

  it("removing from any state starts over", () => {
    const actions: PhotoUploadAction[] = [
      { type: "picked" },
      { type: "unusable" },
      { type: "failed", cause: "limit" },
    ];
    for (const action of actions) {
      expect(run(run(INITIAL_PHOTO, { type: "picked" }, action), { type: "removed" })).toEqual(
        INITIAL_PHOTO,
      );
    }
  });

  it("ignores an answer that arrives in the wrong state", () => {
    expect(run(INITIAL_PHOTO, { type: "uploaded", photoId: "p" })).toBe(INITIAL_PHOTO);
    expect(run(INITIAL_PHOTO, { type: "retried" })).toBe(INITIAL_PHOTO);
  });
});

describe("photoIdToSend (what the entry carries)", () => {
  const ready: PhotoUploadState = { status: "ready", blob, previewUrl: null, photoId: "p-1" };
  const failed: PhotoUploadState = { status: "failed", blob, previewUrl: null, cause: "retry" };

  it("a ready photo is its id", () => {
    expect(photoIdToSend(ready, false)).toBe("p-1");
  });

  it("no new photo and the old one removed is null", () => {
    expect(photoIdToSend(INITIAL_PHOTO, true)).toBeNull();
  });

  it("no new photo and nothing removed leaves the field out (an edit keeps the photo)", () => {
    expect(photoIdToSend(INITIAL_PHOTO, false)).toBeUndefined();
    expect(photoIdToSend({ status: "unusable" }, false)).toBeUndefined();
    expect(photoIdToSend(failed, false)).toBeUndefined();
  });

  it("a failed new photo over a removed old one still removes it", () => {
    expect(photoIdToSend(failed, true)).toBeNull();
  });
});
