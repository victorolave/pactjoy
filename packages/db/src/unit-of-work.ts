import type { Result, UnitOfWork } from "@pactjoy/app";
import type { Client, SqlExecutor } from "./client.ts";
import { isRetryable, mapError } from "./errors.ts";

/**
 * Thrown inside `begin` to make the driver roll back when `work` resolves
 * `{ ok: false }`: the Result is a value, not a failure, so it is caught
 * below and handed back to the caller instead of being rethrown.
 */
class RollbackSignal {
  constructor(readonly result: Result<never, unknown>) {}
}

/** The original run plus one re-run; see `createUnitOfWork`. */
const MAX_ATTEMPTS = 2;

/**
 * The Unit of Work over Postgres: one `begin` per attempt, at READ COMMITTED.
 * `bind` builds the repositories for that transaction's executor. Failures
 * raised by Postgres are mapped (`mapError`); anything `work` throws itself
 * comes back unchanged.
 *
 * Retry: only a failure raised BY POSTGRES as 40P01 or 40001 re-runs `work`,
 * in a new transaction, at most MAX_ATTEMPTS in total; the last failure is then
 * mapped to ConcurrencyConflict. A version-mismatch ConcurrencyConflict, a
 * 23505, an `{ ok: false }` Result and any other error are never retried:
 * the loser must lose. A 40001/40P01 raised at COMMIT also triggers the
 * re-run, even though `work` had already returned ok.
 *
 * `read` is one REPEATABLE READ READ ONLY snapshot, so a multi-query load
 * never tears. A write inside it fails with 25006, rethrown raw (a caller
 * bug). It is not retried: it holds no locks and the caller can read again.
 *
 * Rules for `work`:
 * - It may run twice, even after it returned ok (a failed COMMIT re-runs it),
 *   so it must have NO external side effects (notifications
 *   go after commit or through an outbox) and must re-read everything through
 *   the repositories it is given: nothing is carried over between attempts.
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
      for (let attempt = 1; ; attempt++) {
        try {
          return await begin("isolation level read committed", async (tx) => {
            const result = await work(bind(tx));
            if (!result.ok) throw new RollbackSignal(result);
            return result;
          });
        } catch (error) {
          if (error instanceof RollbackSignal) return error.result as Result<T, E>;
          if (isRetryable(error) && attempt < MAX_ATTEMPTS) continue;
          throw mapError(error);
        }
      }
    },

    async read(work) {
      try {
        return await begin("isolation level repeatable read read only", async (tx) =>
          work(bind(tx)),
        );
      } catch (error) {
        throw mapError(error);
      }
    },
  };
}
