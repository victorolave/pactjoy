import type { Sharing } from "../ports/sharing.ts";

/** Scriptable Sharing: records what was shared or copied. */
export class FakeSharing implements Sharing {
  readonly shared: { title: string; text: string }[] = [];
  readonly copied: string[] = [];
  /** What `share` answers; set to "dismissed" to simulate closing the sheet. */
  shareResult: "shared" | "dismissed" = "shared";
  /** When set, `copy` rejects with it. */
  copyError: Error | null = null;

  readonly #shareAvailable: boolean;

  constructor(shareAvailable = true) {
    this.#shareAvailable = shareAvailable;
  }

  canShare(): boolean {
    return this.#shareAvailable;
  }

  async share(data: { readonly title: string; readonly text: string }) {
    this.shared.push({ ...data });
    return this.shareResult;
  }

  async copy(text: string): Promise<void> {
    if (this.copyError !== null) throw this.copyError;
    this.copied.push(text);
  }
}
