import { describe, expect, it } from "vitest";
import {
  ATTACH_WINDOW_MS,
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_OPEN_UPLOADS,
  MAX_PHOTO_BYTES,
  SWEEP_BATCH,
  UPLOAD_URL_TTL_SECONDS,
} from "./limits.ts";

describe("entry photo limits (ADR-0016)", () => {
  it("pins the agreed values", () => {
    expect(MAX_PHOTO_BYTES).toBe(3 * 1024 * 1024);
    expect(UPLOAD_URL_TTL_SECONDS).toBe(300);
    expect(DOWNLOAD_URL_TTL_SECONDS).toBe(600);
    expect(MAX_OPEN_UPLOADS).toBe(5);
    expect(SWEEP_BATCH).toBe(20);
    expect(ATTACH_WINDOW_MS).toBe(30 * 60 * 1000);
  });

  // P5: no PUT may land after a pending row has expired and been swept, or the sweep would
  // leave an orphan object behind.
  it("keeps the upload URL TTL strictly shorter than the attach window", () => {
    expect(UPLOAD_URL_TTL_SECONDS * 1000).toBeLessThan(ATTACH_WINDOW_MS);
  });
});
