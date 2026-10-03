import type { IdSource } from "../ports/ids.ts";

/** Predictable ids for tests: `id-1`, `id-2`, ... */
export class SequentialIds implements IdSource {
  #count = 0;

  newId(): string {
    this.#count += 1;
    return `id-${this.#count}`;
  }
}
