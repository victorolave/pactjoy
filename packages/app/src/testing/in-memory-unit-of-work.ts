import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Result } from "../shared/result.ts";

/**
 * One isolated transaction's repositories view, plus its atomic commit
 * (ADR-0008, D4/D5). `repositories` is expected to buffer writes locally
 * and never mutate anything live until `commit()` succeeds -- see
 * `in-memory-circle-repository.ts`'s `beginTransaction()` for the concrete
 * per-aggregate version-check-then-apply-all-or-nothing implementation.
 */
export interface InMemoryTransactionScope<Repositories> {
  readonly repositories: Repositories;
  /** @throws if any touched aggregate's version no longer matches what this transaction read. */
  commit(): void;
}

export interface InMemoryUnitOfWorkOptions<Repositories> {
  /** The live repositories view for read-only queries (`read()`). */
  readonly repositories: Repositories;
  /** Opens a fresh, isolated scope for one `transaction()` call. */
  readonly beginTransaction: () => InMemoryTransactionScope<Repositories>;
}

/**
 * Deterministic in-memory {@link UnitOfWork} for tests (ADR-0008). Each
 * `transaction()` call opens its own scope via `beginTransaction()`; `work`
 * only ever sees that scope's buffered view, never the live repositories
 * directly, so a transaction that fails -- by returning `err` or by
 * throwing, including a `commit()`-time `ConcurrencyConflict` -- simply
 * never commits and leaves no trace. There is deliberately no
 * snapshot/restore step here: nothing was ever mutated live to undo, so a
 * failing transaction can never clobber a *different*, concurrently
 * committed transaction's write (D5) -- unlike a global-snapshot rollback
 * would.
 */
export function createInMemoryUnitOfWork<Repositories>(
  options: InMemoryUnitOfWorkOptions<Repositories>,
): UnitOfWork<Repositories> {
  const { repositories, beginTransaction } = options;

  return {
    async transaction<T, E>(
      work: (repositories: Repositories) => Promise<Result<T, E>>,
    ): Promise<Result<T, E>> {
      const scope = beginTransaction();
      const result = await work(scope.repositories);
      if (result.ok) {
        scope.commit();
      }
      return result;
    },

    async read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
      return work(repositories);
    },
  };
}
