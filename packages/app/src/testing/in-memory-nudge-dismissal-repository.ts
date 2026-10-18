import type { NudgeDismissal } from "../encouragement/encouragement.ts";
import type { NudgeDismissalRepository } from "../encouragement/nudge-dismissal.repository.ts";

/** The natural key of a dismissal: one per case. */
function keyOf(d: NudgeDismissal): string {
  return `${d.seasonId}|${d.viewerId}|${d.targetId}|${d.caseWeek}`;
}

/**
 * One isolated transaction's view of the repository, plus its two-phase commit: same
 * `validate()`/`apply()` split as `in-memory-review-repository.ts`, so a `UnitOfWork`
 * spanning several repositories stays atomic.
 */
export interface NudgeDismissalTransactionScope {
  readonly repository: NudgeDismissalRepository;
  /** Never throws: dismissals are idempotent, so there is nothing to conflict. */
  validate(): void;
  /** Applies every staged write to the live store, keeping the first dismissal of a case. */
  apply(): void;
}

export interface InMemoryNudgeDismissalRepository extends NudgeDismissalRepository {
  beginTransaction(): NudgeDismissalTransactionScope;
}

type Store = ReadonlyMap<string, NudgeDismissal>;

function listMine(store: Store, seasonId: string, viewerId: string): NudgeDismissal[] {
  return [...store.values()]
    .filter((d) => d.seasonId === seasonId && d.viewerId === viewerId)
    .sort(
      (a, b) =>
        a.dismissedAt - b.dismissedAt ||
        (a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0) ||
        a.caseWeek - b.caseWeek,
    );
}

/**
 * Deterministic in-memory {@link NudgeDismissalRepository} for tests (ADR-0008). Same rule as the
 * database adapter: a case is dismissed once, and dismissing it again keeps the first row.
 */
export function createInMemoryNudgeDismissalRepository(): InMemoryNudgeDismissalRepository {
  const store = new Map<string, NudgeDismissal>();

  return {
    async listMine(seasonId, viewerId) {
      return listMine(store, seasonId, viewerId);
    },

    async add(dismissal) {
      if (!store.has(keyOf(dismissal))) store.set(keyOf(dismissal), dismissal);
    },

    beginTransaction(): NudgeDismissalTransactionScope {
      const staged = new Map<string, NudgeDismissal>();

      function view(): Map<string, NudgeDismissal> {
        const merged = new Map(store);
        for (const [key, dismissal] of staged) if (!merged.has(key)) merged.set(key, dismissal);
        return merged;
      }

      return {
        repository: {
          async listMine(seasonId, viewerId) {
            return listMine(view(), seasonId, viewerId);
          },
          async add(dismissal) {
            if (!view().has(keyOf(dismissal))) staged.set(keyOf(dismissal), dismissal);
          },
        },
        validate(): void {},
        apply(): void {
          for (const [key, dismissal] of staged) if (!store.has(key)) store.set(key, dismissal);
        },
      };
    },
  };
}
