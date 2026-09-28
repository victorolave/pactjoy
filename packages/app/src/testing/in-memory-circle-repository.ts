import type { CircleRepository } from "../circle/circle.repository.ts";
import type { Circle } from "../circle/circle.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { CircleId, UserId } from "../shared/ids.ts";

interface StagedWrite {
  readonly circle: Circle;
  readonly expectedVersion: number | null;
}

/** One isolated transaction's view of the repository, plus its atomic commit (ADR-0008, D4/D5). */
export interface CircleTransactionScope {
  /**
   * Reads see this scope's own staged writes layered over the live store
   * (read-your-own-writes); `save()` only stages a write -- it never
   * mutates the live store and never throws on a version mismatch (that
   * check is deferred to `commit()`, atomically, across every staged
   * write).
   */
  readonly repository: CircleRepository;
  /**
   * Checks every staged write's `expectedVersion` against the CURRENT live
   * store, all together. If every one still matches, applies all of them;
   * if even one does not, applies NONE of them (no partial commit) and
   * throws {@link ConcurrencyConflict}.
   */
  commit(): void;
}

export interface InMemoryCircleRepository extends CircleRepository {
  beginTransaction(): CircleTransactionScope;
}

function findByInviteCode(store: ReadonlyMap<CircleId, Circle>, code: string): Circle | null {
  for (const circle of store.values()) {
    if (circle.invite && circle.invite.code === code) {
      return circle;
    }
  }
  return null;
}

function findActiveByUser(store: ReadonlyMap<CircleId, Circle>, userId: UserId): Circle | null {
  for (const circle of store.values()) {
    if (circle.members.some((member) => member.userId === userId && member.status === "active")) {
      return circle;
    }
  }
  return null;
}

/** Deterministic in-memory {@link CircleRepository} for tests (ADR-0008). */
export function createInMemoryCircleRepository(): InMemoryCircleRepository {
  const store = new Map<CircleId, Circle>();

  return {
    async get(id: CircleId): Promise<Circle | null> {
      return store.get(id) ?? null;
    },

    async findByInviteCode(code: string): Promise<Circle | null> {
      return findByInviteCode(store, code);
    },

    async findActiveByUser(userId: UserId): Promise<Circle | null> {
      return findActiveByUser(store, userId);
    },

    async save(circle: Circle, expectedVersion: number | null): Promise<void> {
      const existing = store.get(circle.id);
      const currentVersion = existing ? existing.version : null;
      if (currentVersion !== expectedVersion) {
        throw new ConcurrencyConflict();
      }
      store.set(circle.id, circle);
    },

    beginTransaction(): CircleTransactionScope {
      const staged = new Map<CircleId, StagedWrite>();

      function view(id: CircleId): Circle | null {
        return staged.get(id)?.circle ?? store.get(id) ?? null;
      }

      function viewMap(): Map<CircleId, Circle> {
        const merged = new Map(store);
        for (const [id, { circle }] of staged) {
          merged.set(id, circle);
        }
        return merged;
      }

      const repository: CircleRepository = {
        async get(id: CircleId): Promise<Circle | null> {
          return view(id);
        },

        async findByInviteCode(code: string): Promise<Circle | null> {
          return findByInviteCode(viewMap(), code);
        },

        async findActiveByUser(userId: UserId): Promise<Circle | null> {
          return findActiveByUser(viewMap(), userId);
        },

        async save(circle: Circle, expectedVersion: number | null): Promise<void> {
          staged.set(circle.id, { circle, expectedVersion });
        },
      };

      return {
        repository,
        commit(): void {
          for (const [id, { expectedVersion }] of staged) {
            const existing = store.get(id);
            const currentVersion = existing ? existing.version : null;
            if (currentVersion !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
          }
          for (const [id, { circle }] of staged) {
            store.set(id, circle);
          }
        },
      };
    },
  };
}
