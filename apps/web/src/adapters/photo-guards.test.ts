import { describe, expect, it } from "vitest";
import { isPhotoUpload } from "./photo-guards.ts";

const UPLOAD = {
  photoId: "11111111-1111-4111-8111-111111111111",
  upload: {
    method: "PUT",
    url: "https://storage.test/entry-photos/o/abc.jpg?X-Amz-Signature=s",
    headers: { "content-type": "image/jpeg" },
    expiresAt: "2026-10-13T12:05:00.000Z",
  },
  attachBy: "2026-10-13T12:30:00.000Z",
};

describe("isPhotoUpload", () => {
  it("accepts the signed request the API sends", () => {
    expect(isPhotoUpload(UPLOAD)).toBe(true);
  });

  it.each([
    ["not an object", null],
    ["no photoId", { ...UPLOAD, photoId: undefined }],
    ["an empty photoId", { ...UPLOAD, photoId: "" }],
    ["no upload", { ...UPLOAD, upload: undefined }],
    ["a POST upload", { ...UPLOAD, upload: { ...UPLOAD.upload, method: "POST" } }],
    ["a missing url", { ...UPLOAD, upload: { ...UPLOAD.upload, url: undefined } }],
    ["a non-string header", { ...UPLOAD, upload: { ...UPLOAD.upload, headers: { a: 1 } } }],
    ["no headers", { ...UPLOAD, upload: { ...UPLOAD.upload, headers: undefined } }],
    ["a numeric expiresAt", { ...UPLOAD, upload: { ...UPLOAD.upload, expiresAt: 5 } }],
    ["no attachBy", { ...UPLOAD, attachBy: undefined }],
  ])("rejects %s", (_name, value) => {
    expect(isPhotoUpload(value)).toBe(false);
  });
});
