import type { NamedCommitment, ReminderNamesPort } from "../ports/reminder-names.ts";
import {
  encodeReminderNames,
  REMINDER_NAMES_CACHE,
  REMINDER_NAMES_KEY,
} from "../sw/reminder-names.ts";

/** The slice of `CacheStorage` the adapter uses, so tests can hand in their own. */
export interface CacheStorageLike {
  open(name: string): Promise<{ put(key: string, response: Response): Promise<void> }>;
  delete(name: string): Promise<boolean>;
}

function defaultCaches(): CacheStorageLike | undefined {
  return typeof caches === "undefined" ? undefined : (caches as unknown as CacheStorageLike);
}

/**
 * The reminder names in Cache Storage, which the page and the service worker share on this
 * origin (`sw.ts` reads them at push time). Failures are swallowed: the reminder then shows the
 * generic copy, which is always safe.
 */
export class CacheReminderNames implements ReminderNamesPort {
  readonly #caches: CacheStorageLike | undefined;

  constructor(storage: CacheStorageLike | undefined = defaultCaches()) {
    this.#caches = storage;
  }

  async save(commitments: readonly NamedCommitment[]): Promise<void> {
    if (this.#caches === undefined) return;
    try {
      const cache = await this.#caches.open(REMINDER_NAMES_CACHE);
      await cache.put(
        REMINDER_NAMES_KEY,
        new Response(encodeReminderNames(commitments), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    } catch {
      // Private mode or storage pressure: the reminder stays generic.
    }
  }

  async clear(): Promise<void> {
    if (this.#caches === undefined) return;
    try {
      await this.#caches.delete(REMINDER_NAMES_CACHE);
    } catch {
      // Nothing more to do: an unreadable cache cannot name anything either.
    }
  }
}
