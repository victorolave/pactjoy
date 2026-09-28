import type { Result } from "../shared/result.ts";

/**
 * Transaction boundary for use cases (ADR-0008, D4). `Repositories` is
 * supplied by each concrete slice (e.g. `{ circles, habits, seasons,
 * entries, pauses }`, not yet defined at this skeleton stage) -- this port
 * stays generic over it so it can be written and tested before any
 * concrete repository exists.
 */
export interface UnitOfWork<Repositories> {
  /**
   * Commits `work`'s side effects when it resolves to `{ ok: true }`, and
   * rolls them back when it resolves to `{ ok: false }` or throws.
   */
  transaction<T, E>(
    work: (repositories: Repositories) => Promise<Result<T, E>>,
  ): Promise<Result<T, E>>;

  /** Runs a read-only query against the current repositories. */
  read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
