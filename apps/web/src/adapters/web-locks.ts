import type { ExclusiveLock } from "../ports/exclusive-lock.ts";

/**
 * The Web Locks API (`navigator.locks`): held across every tab of this origin and released when the
 * work settles or the tab goes away. Where it is missing, the work runs without a lock; the outbox
 * still reads the stored state before each change, so a second tab can at worst send a request
 * twice, which the server's idempotency absorbs.
 */
export class WebLocks implements ExclusiveLock {
  readonly #locks: LockManager | undefined;

  constructor(locks: LockManager | undefined = globalThis.navigator?.locks) {
    this.#locks = locks;
  }

  run<T>(name: string, work: () => Promise<T>): Promise<T> {
    if (this.#locks === undefined) return work();
    return this.#locks.request(name, work) as Promise<T>;
  }
}
