import type { Connectivity } from "../ports/connectivity.ts";

export class FakeConnectivity implements Connectivity {
  #online: boolean;
  readonly #listeners = new Set<(online: boolean) => void>();

  constructor(online = true) {
    this.#online = online;
  }

  isOnline(): boolean {
    return this.#online;
  }

  subscribe(onChange: (online: boolean) => void): () => void {
    this.#listeners.add(onChange);
    return () => this.#listeners.delete(onChange);
  }

  setOnline(online: boolean): void {
    this.#online = online;
    for (const listener of this.#listeners) listener(online);
  }
}
