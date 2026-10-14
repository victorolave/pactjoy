import type { ImageProcessor, PrepareResult } from "../ports/image-processor.ts";

const DEFAULT: PrepareResult = {
  ok: true,
  photo: { blob: new Blob(["jpeg"], { type: "image/jpeg" }), width: 1600, height: 1200 },
};

/** Scriptable stand-in for the canvas: answers what the test says and records what it was given. */
export class FakeImageProcessor implements ImageProcessor {
  readonly prepared: Blob[] = [];
  #result: PrepareResult = DEFAULT;
  #gate: Promise<void> | null = null;

  setResult(result: PrepareResult): void {
    this.#result = result;
  }

  /** Holds the next `prepare` until the returned function is called (to see "Preparando foto…"). */
  hold(): () => void {
    let release = () => {};
    this.#gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  async prepare(file: Blob): Promise<PrepareResult> {
    this.prepared.push(file);
    const gate = this.#gate;
    this.#gate = null;
    await gate;
    return this.#result;
  }
}
