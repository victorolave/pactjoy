import type { Visibility } from "../ports/visibility.ts";

/** `document.visibilityState` and the document's visibilitychange event. */
export class BrowserVisibility implements Visibility {
  isVisible(): boolean {
    return document.visibilityState === "visible";
  }

  subscribe(onChange: (visible: boolean) => void): () => void {
    const changed = () => onChange(this.isVisible());
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }
}
