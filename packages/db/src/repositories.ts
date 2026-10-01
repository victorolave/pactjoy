import type { Repositories } from "@pactjoy/app";
import { createPgCircleRepository } from "./circle/pg-circle-repository.ts";
import type { SqlExecutor } from "./client.ts";
import { createPgHabitRepository } from "./habit/pg-habit-repository.ts";
import type { BindMode } from "./unit-of-work.ts";

/** The repositories this adapter has so far; each slice adds its own. */
export type PgRepositories = Pick<Repositories, "habits" | "circles">;

/**
 * Fresh repositories closed over ONE transaction's executor. Nothing is shared
 * between transactions, so a repository can never run outside its transaction.
 */
export function bindRepositories(exec: SqlExecutor, mode: BindMode): PgRepositories {
  return { habits: createPgHabitRepository(exec), circles: createPgCircleRepository(exec, mode) };
}
