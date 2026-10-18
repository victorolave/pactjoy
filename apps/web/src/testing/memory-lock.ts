import type { ExclusiveLock } from "../ports/exclusive-lock.ts";

/** An `ExclusiveLock` shared by the "tabs" of a test: work under one name runs one at a time. */
export class MemoryLock implements ExclusiveLock {
  readonly #tails = new Map<string, Promise<unknown>>();
  /** The names asked for, in order. */
  readonly requested: string[] = [];

  run<T>(name: string, work: () => Promise<T>): Promise<T> {
    this.requested.push(name);
    const previous = this.#tails.get(name) ?? Promise.resolve();
    const result = previous.then(work, work);
    this.#tails.set(
      name,
      result.catch(() => undefined),
    );
    return result;
  }
}
