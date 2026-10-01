import type { Repositories } from "@pactjoy/app";
import { createPgCircleRepository } from "./circle/pg-circle-repository.ts";
import type { BindMode, SqlExecutor } from "./client.ts";
import { createPgEntryRepository } from "./entry/pg-entry-repository.ts";
import { createPgHabitRepository } from "./habit/pg-habit-repository.ts";
import { createNoPauseRequestReader } from "./pause/no-pause-request-reader.ts";
import { createPgSeasonRepository } from "./season/pg-season-repository.ts";

/** Every repository the application's `UnitOfWork` hands to a use case. */
export type PgRepositories = Repositories;

/**
 * Fresh repositories closed over ONE transaction's executor. Nothing is shared
 * between transactions, so a repository can never run outside its transaction.
 */
export function bindRepositories(exec: SqlExecutor, mode: BindMode): PgRepositories {
  return {
    habits: createPgHabitRepository(exec),
    circles: createPgCircleRepository(exec, mode),
    seasons: createPgSeasonRepository(exec, mode),
    entries: createPgEntryRepository(exec),
    // TODO(A2): replace with the table-backed reader.
    pauses: createNoPauseRequestReader(),
  };
}
