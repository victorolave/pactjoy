import type { RateLimitCounter, RateLimitRepository } from "../rate-limit/rate-limit.repository.ts";
import type { Instant } from "../time/instant.ts";

interface Stored {
  readonly hits: number;
  readonly expiresAt: Instant;
}

type Store = ReadonlyMap<string, Stored>;

const keyOf = (c: RateLimitCounter) =>
  `${c.action}|${c.subject}|${c.windowSeconds}|${c.windowStart}`;
const subjectOf = (key: string) => key.split("|")[1] ?? "";

/** Adds `extra` hits to `key` in `into`. */
function add(into: Map<string, Stored>, key: string, extra: Stored): void {
  into.set(key, { hits: (into.get(key)?.hits ?? 0) + extra.hits, expiresAt: extra.expiresAt });
}

function operations(
  view: () => Store,
  increment: (key: string, expiresAt: Instant) => void,
  drop: (key: string) => void,
): RateLimitRepository {
  return {
    async hit(counters) {
      return counters.map((counter) => {
        const key = keyOf(counter);
        increment(key, (counter.windowStart + counter.windowSeconds * 1000) as Instant);
        return view().get(key)?.hits ?? 0;
      });
    },
    async sweepExpired(now) {
      for (const [key, { expiresAt }] of view()) if (expiresAt <= now) drop(key);
    },
    async deleteBySubjects(subjects) {
      const gone = new Set(subjects);
      for (const key of view().keys()) if (gone.has(subjectOf(key))) drop(key);
    },
  };
}

export interface RateLimitTransactionScope {
  readonly repository: RateLimitRepository;
  /** Counters never conflict (every hit is an increment), so there is nothing to validate. */
  validate(): void;
  /** Applies every staged write. */
  apply(): void;
}

export interface InMemoryRateLimitRepository extends RateLimitRepository {
  beginTransaction(): RateLimitTransactionScope;
}

/**
 * Deterministic in-memory {@link RateLimitRepository} for tests (ADR-0020). A transaction stages
 * its hits and applies them as increments on commit, like the database's atomic upsert.
 */
export function createInMemoryRateLimitRepository(): InMemoryRateLimitRepository {
  const store = new Map<string, Stored>();
  return {
    ...operations(
      () => store,
      (key, expiresAt) => add(store, key, { hits: 1, expiresAt }),
      (key) => void store.delete(key),
    ),
    beginTransaction(): RateLimitTransactionScope {
      const added = new Map<string, Stored>();
      const drops = new Set<string>();
      const view = (): Store => {
        const merged = new Map(store);
        for (const key of drops) merged.delete(key);
        for (const [key, extra] of added) add(merged, key, extra);
        return merged;
      };
      return {
        repository: operations(
          view,
          (key, expiresAt) => add(added, key, { hits: 1, expiresAt }),
          (key) => {
            added.delete(key);
            drops.add(key);
          },
        ),
        validate(): void {},
        apply(): void {
          for (const key of drops) store.delete(key);
          for (const [key, extra] of added) add(store, key, extra);
        },
      };
    },
  };
}
