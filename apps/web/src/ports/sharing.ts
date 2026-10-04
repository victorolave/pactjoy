/** Handing text to another app (the invite message) or to the clipboard. */
export interface Sharing {
  /** Whether the system share sheet exists here; when false the UI hides "Compartir". */
  canShare(): boolean;
  /** `dismissed` when the user closes the sheet; it is not an error. Other failures reject. */
  share(data: { readonly title: string; readonly text: string }): Promise<"shared" | "dismissed">;
  /** Rejects when the clipboard is unavailable or refused. */
  copy(text: string): Promise<void>;
}
