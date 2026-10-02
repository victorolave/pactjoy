import type { CircleRepository } from "../circle/circle.repository.ts";
import type { Circle } from "../circle/circle.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { CircleId, UserId } from "../shared/ids.ts";

interface StagedWrite {
  readonly circle: Circle;
  readonly expectedVersion: number | null;
}

/**
 * One isolated transaction's view of the repository, plus its two-phase
 * commit (ADR-0008, D4/D5). Split into `validate()`/`apply()` -- instead of
 * one combined `commit()` -- so a UnitOfWork spanning MULTIPLE repositories
 * can validate every touched repository first and only apply any of them
 * once none has thrown: `validate()` on scope A, then scope B, THEN
 * `apply()` on scope A, then scope B. Calling `validate()` alone (without
 * `apply()`) never mutates the live store, which is exactly what makes
 * that combined "check everything, then apply everything" possible without
 * a partial commit across repositories (see `testing/app-harness.ts`'s
 * `beginTransaction`).
 */
export interface CircleTransactionScope {
  /**
   * Reads see this scope's own staged writes layered over the live store
   * (read-your-own-writes); `save()` only stages a write -- it never
   * mutates the live store and never throws on a version mismatch (that
   * check is `validate()`'s job).
   */
  readonly repository: CircleRepository;
  /** @throws {ConcurrencyConflict} if any staged write's `expectedVersion` no longer matches the live store, or would give a user a second active membership. Does not mutate. */
  validate(): void;
  /** Applies every staged write to the live store. Callers MUST call `validate()` first (see docstring above). */
  apply(): void;
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

/**
 * A5 / CM-18: one active membership per user across the whole `view`. Throws
 * the same `ConcurrencyConflict` that Postgres's unique partial index
 * `circle_members_active_user_key` yields. Only the `touched` circles are
 * checked, against every circle in the view (a user active twice inside one
 * circle trips it too).
 */
function assertOneActiveCirclePerUser(
  view: ReadonlyMap<CircleId, Circle>,
  touched: Iterable<Circle>,
): void {
  for (const circle of touched) {
    const seen = new Set<UserId>();
    for (const member of circle.members) {
      if (member.status !== "active") continue;
      if (seen.has(member.userId)) throw new ConcurrencyConflict();
      seen.add(member.userId);
    }
    for (const other of view.values()) {
      if (other.id === circle.id) continue;
      const clash = other.members.some((m) => m.status === "active" && seen.has(m.userId));
      if (clash) throw new ConcurrencyConflict();
    }
  }
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

    async guardVersion(): Promise<void> {
      // Read-set guards only mean something inside a transaction.
    },

    async save(circle: Circle, expectedVersion: number | null): Promise<void> {
      const existing = store.get(circle.id);
      const currentVersion = existing ? existing.version : null;
      if (currentVersion !== expectedVersion) {
        throw new ConcurrencyConflict();
      }
      assertOneActiveCirclePerUser(new Map(store).set(circle.id, circle), [circle]);
      store.set(circle.id, circle);
    },

    beginTransaction(): CircleTransactionScope {
      const staged = new Map<CircleId, StagedWrite>();
      const guards = new Map<CircleId, number>();

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

        async guardVersion(id: CircleId, expectedVersion: number): Promise<void> {
          guards.set(id, expectedVersion);
        },

        async save(circle: Circle, expectedVersion: number | null): Promise<void> {
          staged.set(circle.id, { circle, expectedVersion });
        },
      };

      return {
        repository,
        validate(): void {
          for (const [id, expectedVersion] of guards) {
            if (store.get(id)?.version !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
          }
          for (const [id, { expectedVersion }] of staged) {
            const existing = store.get(id);
            const currentVersion = existing ? existing.version : null;
            if (currentVersion !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
          }
          assertOneActiveCirclePerUser(
            viewMap(),
            [...staged.values()].map((write) => write.circle),
          );
        },
        apply(): void {
          for (const [id, { circle }] of staged) {
            store.set(id, circle);
          }
        },
      };
    },
  };
}
