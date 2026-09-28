import type { SeasonRepository } from "../season/season.repository.ts";
import type { Season } from "../season/season.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { CircleId, SeasonId } from "../shared/ids.ts";

interface StagedWrite {
  readonly season: Season;
  readonly expectedVersion: number | null;
}

/**
 * One isolated transaction's view of the repository, plus its two-phase
 * commit (ADR-0008, D4/D5), same `validate()`/`apply()` split as
 * `in-memory-circle-repository.ts` -- see its docstring for why a UnitOfWork
 * spanning multiple repositories needs the two calls separated.
 */
export interface SeasonTransactionScope {
  /**
   * Reads see this scope's own staged writes layered over the live store
   * (read-your-own-writes); `save()` only stages a write, same pattern as
   * `in-memory-circle-repository.ts`.
   */
  readonly repository: SeasonRepository;
  /** @throws {ConcurrencyConflict} if any staged write's `expectedVersion` no longer matches the live store. Does not mutate. */
  validate(): void;
  /** Applies every staged write to the live store. Callers MUST call `validate()` first (see docstring above). */
  apply(): void;
}

export interface InMemorySeasonRepository extends SeasonRepository {
  beginTransaction(): SeasonTransactionScope;
}

function findLatestByCircle(
  store: ReadonlyMap<SeasonId, Season>,
  circleId: CircleId,
): Season | null {
  let latest: Season | null = null;
  for (const season of store.values()) {
    if (season.circleId !== circleId) continue;
    if (!latest || season.createdAt > latest.createdAt) {
      latest = season;
    }
  }
  return latest;
}

/** Deterministic in-memory {@link SeasonRepository} for tests (ADR-0008). */
export function createInMemorySeasonRepository(): InMemorySeasonRepository {
  const store = new Map<SeasonId, Season>();

  return {
    async get(id: SeasonId): Promise<Season | null> {
      return store.get(id) ?? null;
    },

    async findLatestByCircle(circleId: CircleId): Promise<Season | null> {
      return findLatestByCircle(store, circleId);
    },

    async save(season: Season, expectedVersion: number | null): Promise<void> {
      const existing = store.get(season.id);
      const currentVersion = existing ? existing.version : null;
      if (currentVersion !== expectedVersion) {
        throw new ConcurrencyConflict();
      }
      store.set(season.id, season);
    },

    beginTransaction(): SeasonTransactionScope {
      const staged = new Map<SeasonId, StagedWrite>();

      function view(id: SeasonId): Season | null {
        return staged.get(id)?.season ?? store.get(id) ?? null;
      }

      function viewMap(): Map<SeasonId, Season> {
        const merged = new Map(store);
        for (const [id, { season }] of staged) {
          merged.set(id, season);
        }
        return merged;
      }

      const repository: SeasonRepository = {
        async get(id: SeasonId): Promise<Season | null> {
          return view(id);
        },

        async findLatestByCircle(circleId: CircleId): Promise<Season | null> {
          return findLatestByCircle(viewMap(), circleId);
        },

        async save(season: Season, expectedVersion: number | null): Promise<void> {
          staged.set(season.id, { season, expectedVersion });
        },
      };

      return {
        repository,
        validate(): void {
          for (const [id, { expectedVersion }] of staged) {
            const existing = store.get(id);
            const currentVersion = existing ? existing.version : null;
            if (currentVersion !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
          }
        },
        apply(): void {
          for (const [id, { season }] of staged) {
            store.set(id, season);
          }
        },
      };
    },
  };
}
