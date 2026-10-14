import { describe, expect, it, vi } from "vitest";
import { MAX_PHOTO_BYTES } from "../ports/image-processor.ts";
import { CanvasImageProcessor, fitWithin } from "./canvas-image-processor.ts";

describe("fitWithin", () => {
  it.each([
    [4000, 3000, 1600, { width: 1600, height: 1200 }],
    [3000, 4000, 1600, { width: 1200, height: 1600 }],
    [1600, 900, 1600, { width: 1600, height: 900 }],
    [800, 600, 1600, { width: 800, height: 600 }],
    [10000, 1, 1600, { width: 1600, height: 1 }],
  ])("%i x %i within %i is %o", (width, height, side, expected) => {
    expect(fitWithin(width, height, side)).toEqual(expected);
  });

  it("never rounds a side to zero", () => {
    expect(fitWithin(100000, 10, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

interface Harness {
  readonly processor: CanvasImageProcessor;
  readonly createImageBitmap: ReturnType<typeof vi.fn>;
  readonly drawImage: ReturnType<typeof vi.fn>;
  readonly toBlob: ReturnType<typeof vi.fn>;
  readonly canvas: { width: number; height: number };
  readonly close: ReturnType<typeof vi.fn>;
}

function harness({
  bitmap = { width: 4000, height: 3000 },
  blobs = [new Blob(["jpeg"], { type: "image/jpeg" })],
  decodeFails = false,
  context = true,
}: {
  bitmap?: { width: number; height: number };
  blobs?: Array<Blob | null>;
  decodeFails?: boolean;
  context?: boolean;
} = {}): Harness {
  const close = vi.fn();
  const createImageBitmap = vi.fn(async () => {
    if (decodeFails) throw new DOMException("bad image", "InvalidStateError");
    return { ...bitmap, close };
  });
  const drawImage = vi.fn();
  const queue = [...blobs];
  const toBlob = vi.fn((callback: (blob: Blob | null) => void) => callback(queue.shift() ?? null));
  const canvas = { width: 0, height: 0 };
  const processor = new CanvasImageProcessor({
    createImageBitmap: createImageBitmap as never,
    createCanvas: () =>
      Object.assign(canvas, {
        getContext: () => (context ? { drawImage, fillRect: vi.fn(), fillStyle: "" } : null),
        toBlob,
      }) as never,
  });
  return { processor, createImageBitmap, drawImage, toBlob, canvas, close };
}

describe("CanvasImageProcessor.prepare", () => {
  it("decodes with the camera's orientation applied and resizes to 1600 px (SC-W1)", async () => {
    const h = harness();
    const file = new File(["raw"], "camera.heic", { type: "image/heic" });

    const result = await h.processor.prepare(file);

    expect(h.createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(h.canvas).toMatchObject({ width: 1600, height: 1200 });
    expect(h.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(result).toMatchObject({ ok: true, photo: { width: 1600, height: 1200 } });
    expect(h.close).toHaveBeenCalled();
  });

  it("re-encodes as JPEG at 0.8, which is what drops EXIF and GPS", async () => {
    const h = harness();

    await h.processor.prepare(new Blob(["x"]));

    expect(h.toBlob).toHaveBeenCalledTimes(1);
    expect(h.toBlob.mock.calls[0]?.slice(1)).toEqual(["image/jpeg", 0.8]);
  });

  it("does not enlarge a small photo", async () => {
    const h = harness({ bitmap: { width: 640, height: 480 } });

    const result = await h.processor.prepare(new Blob(["x"]));

    expect(result).toMatchObject({ ok: true, photo: { width: 640, height: 480 } });
  });

  it("tries again at 0.6 when the first encoding is above the limit", async () => {
    const big = { size: MAX_PHOTO_BYTES + 1, type: "image/jpeg" } as Blob;
    const small = new Blob(["ok"], { type: "image/jpeg" });
    const h = harness({ blobs: [big, small] });

    const result = await h.processor.prepare(new Blob(["x"]));

    expect(h.toBlob.mock.calls.map((call) => call[2])).toEqual([0.8, 0.6]);
    expect(result).toMatchObject({ ok: true, photo: { blob: small } });
  });

  it("says tooLarge when 0.6 is still above the limit", async () => {
    const big = { size: MAX_PHOTO_BYTES + 1, type: "image/jpeg" } as Blob;
    const h = harness({ blobs: [big, big] });

    await expect(h.processor.prepare(new Blob(["x"]))).resolves.toEqual({
      ok: false,
      reason: "tooLarge",
    });
  });

  it("says unreadable when the image cannot be decoded", async () => {
    const h = harness({ decodeFails: true });

    await expect(h.processor.prepare(new Blob(["x"]))).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(h.toBlob).not.toHaveBeenCalled();
  });

  it("says unreadable for an empty bitmap, no 2d context or an encoder that gave nothing", async () => {
    for (const options of [
      { bitmap: { width: 0, height: 0 } },
      { context: false },
      { blobs: [null] },
      { blobs: [new Blob(["png"], { type: "image/png" })] },
    ]) {
      const h = harness(options);
      await expect(h.processor.prepare(new Blob(["x"]))).resolves.toEqual({
        ok: false,
        reason: "unreadable",
      });
    }
  });
});
