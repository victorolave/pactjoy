import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Result } from "../shared/result.ts";

export interface InMemoryUnitOfWorkOptions<Repositories, Snapshot> {
  /** The shared, mutable in-memory repositories every use case call sees. */
  readonly repositories: Repositories;
  /** Captures enough state to undo any writes `work` made. */
  readonly snapshot: () => Snapshot;
  /** Restores `repositories` to a previously captured snapshot. */
  readonly restore: (snapshot: Snapshot) => void;
}

/**
 * Deterministic in-memory {@link UnitOfWork} for tests (ADR-0008): commits
 * on `ok`, restores the pre-transaction snapshot on `err` or on a thrown
 * error. Each concrete slice's in-memory repositories (e.g.
 * `in-memory-circle-repository.ts`) supply their own `snapshot`/`restore`
 * pair -- this adapter owns only the commit/rollback control flow.
 */
export function createInMemoryUnitOfWork<Repositories, Snapshot>(
  options: InMemoryUnitOfWorkOptions<Repositories, Snapshot>,
): UnitOfWork<Repositories> {
  const { repositories, snapshot, restore } = options;

  return {
    async transaction<T, E>(
      work: (repositories: Repositories) => Promise<Result<T, E>>,
    ): Promise<Result<T, E>> {
      const before = snapshot();
      try {
        const result = await work(repositories);
        if (!result.ok) {
          restore(before);
        }
        return result;
      } catch (error) {
        restore(before);
        throw error;
      }
    },

    async read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
      return work(repositories);
    },
  };
}
