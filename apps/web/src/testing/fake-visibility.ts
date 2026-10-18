import type { Visibility } from "../ports/visibility.ts";

export class FakeVisibility implements Visibility {
  #visible: boolean;
  readonly #listeners = new Set<(visible: boolean) => void>();

  constructor(visible = true) {
    this.#visible = visible;
  }

  isVisible(): boolean {
    return this.#visible;
  }

  subscribe(onChange: (visible: boolean) => void): () => void {
    this.#listeners.add(onChange);
    return () => this.#listeners.delete(onChange);
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    for (const listener of this.#listeners) listener(visible);
  }
}
