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

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Harness-only: simulates the Supabase defaults, where the migrating role
 * grants everything on new tables and sequences to `anon` and `authenticated`.
 * Without the `scope`, the grant is global; with it, in-schema (the schema must exist).
 * Default privileges are per database, so run it on the database about to be migrated.
 */
export async function simulateClientDefaultGrants(sql: Sql, schema?: string): Promise<void> {
  const [me] = await sql`select current_user as name`;
  const role = quote(String(me?.name));
  const scope = schema ? ` in schema ${quote(schema)}` : "";
  for (const kind of ["tables", "sequences"])
    await sql.unsafe(
      `alter default privileges for role ${role}${scope} grant all on ${kind} to anon, authenticated`,
    );
}
