import type { Sharing } from "../ports/sharing.ts";

/** Web Share and the async clipboard where the browser has them. */
export class BrowserSharing implements Sharing {
  canShare(): boolean {
    return typeof navigator.share === "function";
  }

  async share(data: {
    readonly title: string;
    readonly text: string;
  }): Promise<"shared" | "dismissed"> {
    try {
      await navigator.share({ title: data.title, text: data.text });
      return "shared";
    } catch (cause) {
      // Closing the sheet rejects with AbortError: the user's choice, not a failure.
      if (cause instanceof DOMException && cause.name === "AbortError") return "dismissed";
      throw cause;
    }
  }

  async copy(text: string): Promise<void> {
    if (navigator.clipboard === undefined) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(text);
  }
}
