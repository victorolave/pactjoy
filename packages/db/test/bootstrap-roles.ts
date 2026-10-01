import type { Sql } from "./db.ts";

const DUPLICATE_OBJECT = "42710";

/** Harness-only (never a migration): creates the roles Supabase already provides. */
export async function bootstrapRoles(sql: Sql): Promise<void> {
  for (const role of ["anon", "authenticated"]) {
    const [found] = await sql`select 1 from pg_roles where rolname = ${role}`;
    if (found) continue;
    try {
      await sql.unsafe(`create role ${role} nologin`);
    } catch (error) {
      // Roles are cluster-wide: another run may have created it since the check.
      if ((error as { code?: string }).code !== DUPLICATE_OBJECT) throw error;
    }
  }
}
