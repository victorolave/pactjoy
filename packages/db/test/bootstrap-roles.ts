import type { Sql } from "./db.ts";

/** Harness-only (never a migration): creates the roles Supabase already provides. */
export async function bootstrapRoles(sql: Sql): Promise<void> {
  for (const role of ["anon", "authenticated"]) {
    const [found] = await sql`select 1 from pg_roles where rolname = ${role}`;
    if (!found) await sql.unsafe(`create role ${role} nologin`);
  }
}
