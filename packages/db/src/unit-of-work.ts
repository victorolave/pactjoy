import type { Result, UnitOfWork } from "@pactjoy/app";
import type { Client, SqlExecutor } from "./client.ts";
import { mapError } from "./errors.ts";

/**
 * Thrown inside `begin` to make the driver roll back when `work` resolves
 * `{ ok: false }`: the Result is a value, not a failure, so it is caught
 * below and handed back to the caller instead of being rethrown.
 */
class RollbackSignal {
  constructor(readonly result: Result<never, unknown>) {}
}

/**
 * The Unit of Work over Postgres: one `begin` per `transaction`, at READ
 * COMMITTED. `bind` builds the repositories for that transaction's executor.
 * Failures raised by Postgres are mapped (`mapError`); anything `work` throws
 * itself comes back unchanged. No retry and no snapshot `read` yet (B3b).
 *
 * Rules for `work`:
 * - It must not swallow a database error. After one, Postgres holds the
 *   transaction in 25P02 and a COMMIT silently becomes a ROLLBACK, while the
 *   caller would see `{ ok: true }`. Let the error propagate.
 * - It must not call `uow.transaction` again: the nested call takes a second
 *   connection and deadlocks the pool when `max` is 1.
 */
export function createUnitOfWork<R>(
  begin: Client["begin"],
  bind: (exec: SqlExecutor) => R,
): UnitOfWork<R> {
  return {
    async transaction<T, E>(work: (repositories: R) => Promise<Result<T, E>>) {
      try {
        return await begin("isolation level read committed", async (tx) => {
          const result = await work(bind(tx));
          if (!result.ok) throw new RollbackSignal(result);
          return result;
        });
      } catch (error) {
        if (error instanceof RollbackSignal) return error.result as Result<T, E>;
        throw mapError(error);
      }
    },

    // TODO(B3b): this must run at "isolation level repeatable read read only"
    // and wrap errors with `mapError` (40001 is possible at that level). Until
    // then it is READ COMMITTED, so a write inside `read` succeeds.
    read: (work) => begin("isolation level read committed", async (tx) => work(bind(tx))),
  };
}
