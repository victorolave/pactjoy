import postgres from "postgres";
import { inject } from "vitest";

export type Sql = postgres.Sql;

/** One-connection client for harness and assertion queries (never the adapter's own client). */
export function connect(url: string): Sql {
  return postgres(url, { prepare: false, max: 1, onnotice: () => {} });
}

/** URL of the migrated database that global-setup provided to this run. */
export function databaseUrl(): string {
  return inject("databaseUrl");
}

/** Runs one statement on its own connection and returns its first row. */
export async function queryOne<T = Record<string, unknown>>(url: string, text: string): Promise<T> {
  const sql = connect(url);
  try {
    const [row] = await sql.unsafe(text);
    return row as T;
  } finally {
    await sql.end();
  }
}
