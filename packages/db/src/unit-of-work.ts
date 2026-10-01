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

    // Placeholder until B3b: a REPEATABLE READ, READ ONLY snapshot.
    read: (work) => begin("isolation level read committed", async (tx) => work(bind(tx))),
  };
}
