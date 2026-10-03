export interface Connectivity {
  isOnline(): boolean;
  /** Called with the new state when the connection drops or returns. Returns the unsubscribe. */
  subscribe(onChange: (online: boolean) => void): () => void;
}
