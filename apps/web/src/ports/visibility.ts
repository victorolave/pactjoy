/** Whether the app is on screen. Coming back to the foreground is a moment to retry what failed. */
export interface Visibility {
  isVisible(): boolean;
  /** Called with the new state when the app goes to the background or returns. Returns the unsubscribe. */
  subscribe(onChange: (visible: boolean) => void): () => void;
}
