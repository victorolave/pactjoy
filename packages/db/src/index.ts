import type { Repositories, UnitOfWork } from "@pactjoy/app";
import { createClient } from "./client.ts";
import { bindRepositories } from "./repositories.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

export { isDatabaseUnavailable } from "./unavailable.ts";

/**
 * Public API of `@pactjoy/db` (`exports: "."` in `package.json`): ONLY this
 * factory, its two types and the isDatabaseUnavailable predicate. No driver type, repository or codec leaves the
 * package, so replacing Postgres means writing another adapter, not touching
 * callers (high decoupling, ADR-0010).
 */

/** The application's Unit of Work over Postgres, plus pool shutdown. */
export type PostgresUnitOfWork = UnitOfWork<Repositories> & { end(): Promise<void> };

export interface PostgresUnitOfWorkOptions {
  /** Connection string. Injected: nothing in this package reads it from the environment. */
  url: string;
  /** Pool size. */
  max?: number;
  /** Seconds to wait for a connection before failing (Node only; see ADR-0010 spike). */
  connectTimeoutSeconds?: number;
}

/**
 * Binds every repository (habits, circles, seasons, entries and the temporary
 * pause reader) to one Postgres pool. Connections open lazily on first use, so
 * an unreachable database fails the first `transaction`/`read`, not this call.
 * Call `end()` to close the pool.
 */
export function createPostgresUnitOfWork(options: PostgresUnitOfWorkOptions): PostgresUnitOfWork {
  if (!options.url || options.url.trim() === "") {
    throw new Error("createPostgresUnitOfWork: `url` must be a non-empty connection string");
  }
  const client = createClient({
    url: options.url,
    max: options.max,
    connectTimeoutSeconds: options.connectTimeoutSeconds,
  });
  return { ...createUnitOfWork(client.begin, bindRepositories), end: () => client.end() };
}
