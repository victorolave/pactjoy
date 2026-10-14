import type { PhotoUploader, SignedUpload, UploadOutcome } from "../ports/photo-uploader.ts";

/** Scriptable stand-in for the storage origin: outcomes in order ("ok" once the script runs out). */
export class FakePhotoUploader implements PhotoUploader {
  readonly puts: { readonly upload: SignedUpload; readonly blob: Blob }[] = [];
  readonly #outcomes: UploadOutcome[] = [];
  #gate: Promise<void> | null = null;

  /** The next calls answer these, one each. */
  script(...outcomes: UploadOutcome[]): void {
    this.#outcomes.push(...outcomes);
  }

  /** Holds the next `put` until the returned function is called (to see "Subiendo foto…"). */
  hold(): () => void {
    let release = () => {};
    this.#gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  async put(upload: SignedUpload, blob: Blob): Promise<UploadOutcome> {
    this.puts.push({ upload, blob });
    const gate = this.#gate;
    this.#gate = null;
    await gate;
    return this.#outcomes.shift() ?? "ok";
  }
}
