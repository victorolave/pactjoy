import {
  type ImageProcessor,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_SIDE,
  type PrepareResult,
} from "../ports/image-processor.ts";

/** The size that fits `width` x `height` inside `side` px on its longest side, never enlarging it. */
export function fitWithin(
  width: number,
  height: number,
  side: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= side) return { width, height };
  const scale = side / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** What the processor needs from the browser; tests hand in stand-ins (jsdom has no canvas). */
export interface CanvasEnvironment {
  readonly createImageBitmap: (
    file: Blob,
    options: { readonly imageOrientation: "from-image" },
  ) => Promise<{ readonly width: number; readonly height: number; close?: () => void }>;
  readonly createCanvas: () => {
    width: number;
    height: number;
    getContext(kind: "2d"): CanvasRenderingContext2D | null;
    toBlob(callback: (blob: Blob | null) => void, type: string, quality: number): void;
  };
}

const browserEnvironment = (): CanvasEnvironment => ({
  createImageBitmap: (file, options) => createImageBitmap(file, options),
  createCanvas: () => document.createElement("canvas"),
});

const QUALITIES = [0.8, 0.6] as const;

/**
 * Decodes with the camera's orientation applied, draws at most 1600 px on the long side and
 * re-encodes as JPEG. The re-encode is what removes EXIF and GPS: only pixels survive. A HEIC pick
 * works where the browser can decode it (iOS Safari does; elsewhere it is `unreadable`).
 */
export class CanvasImageProcessor implements ImageProcessor {
  readonly #env: CanvasEnvironment;

  constructor(env: CanvasEnvironment = browserEnvironment()) {
    this.#env = env;
  }

  async prepare(file: Blob): Promise<PrepareResult> {
    let bitmap: Awaited<ReturnType<CanvasEnvironment["createImageBitmap"]>>;
    try {
      bitmap = await this.#env.createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    try {
      if (!(bitmap.width > 0 && bitmap.height > 0)) return { ok: false, reason: "unreadable" };
      const size = fitWithin(bitmap.width, bitmap.height, MAX_PHOTO_SIDE);
      const canvas = this.#env.createCanvas();
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (context === null) return { ok: false, reason: "unreadable" };
      // JPEG has no transparency: a PNG with a clear background would turn black without this.
      context.fillStyle = "white";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, size.width, size.height);
      for (const quality of QUALITIES) {
        const blob = await encode(canvas, quality);
        if (blob === null || blob.type !== "image/jpeg") return { ok: false, reason: "unreadable" };
        if (blob.size <= MAX_PHOTO_BYTES) return { ok: true, photo: { blob, ...size } };
      }
      return { ok: false, reason: "tooLarge" };
    } finally {
      bitmap.close?.();
    }
  }
}

const encode = (
  canvas: ReturnType<CanvasEnvironment["createCanvas"]>,
  quality: number,
): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
