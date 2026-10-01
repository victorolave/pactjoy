import type { Repositories } from "@pactjoy/app";
import type { SqlExecutor } from "./client.ts";
import { createPgHabitRepository } from "./habit/pg-habit-repository.ts";

/** The repositories this adapter has so far; each slice adds its own. */
export type PgRepositories = Pick<Repositories, "habits">;

/**
 * Fresh repositories closed over ONE transaction's executor. Nothing is shared
 * between transactions, so a repository can never run outside its transaction.
 */
export function bindRepositories(exec: SqlExecutor): PgRepositories {
  return { habits: createPgHabitRepository(exec) };
}
