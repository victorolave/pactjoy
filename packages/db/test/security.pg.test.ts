import { afterAll, describe, expect, it } from "vitest";
import { connect, databaseUrl } from "./db.ts";

const admin = connect(databaseUrl());
const ROLES = ["anon", "authenticated"] as const;

afterAll(() => admin.end());

const tables = async () =>
  (
    await admin`select tablename as name from pg_tables where schemaname = 'pactjoy' order by 1`
  ).map((row) => String(row.name));

/** Runs one statement as `role` (SET LOCAL ROLE) and returns the SQLSTATE, or null on success. */
async function sqlstateAs(role: string, statement: string): Promise<string | null> {
  try {
    await admin.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      await tx.unsafe(statement);
      throw new Error("rollback");
    });
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? null;
  }
}

describe("schema security", () => {
  it("SS-S1: every table lives in pactjoy and public has none", async () => {
    expect((await tables()).length).toBeGreaterThan(0);
    const stray = await admin`select tablename from pg_tables where schemaname = 'public'`;
    expect(stray).toEqual([]);
  });

  it("SS-S2: client roles have no USAGE on the schema", async () => {
    for (const role of ROLES) {
      const [row] = await admin`select has_schema_privilege(${role}, 'pactjoy', 'USAGE') as ok`;
      expect(row?.ok, role).toBe(false);
    }
  });

  it("SS-S4: every table has RLS enabled (catalog scan) and no policy exists", async () => {
    const withoutRls = await admin`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pactjoy' and c.relkind in ('r', 'p') and not c.relrowsecurity`;
    expect(withoutRls).toEqual([]);
    const policies = await admin`select policyname from pg_policies where schemaname = 'pactjoy'`;
    expect(policies).toEqual([]);
  });

  it("SS-S5/S6: anon and authenticated can neither read nor write any table", async () => {
    for (const table of await tables()) {
      const [col] = await admin`
        select attname from pg_attribute
        where attrelid = ${`pactjoy.${table}`}::regclass and attnum > 0 and not attisdropped
        order by attnum limit 1`;
      const statements = [
        `select * from pactjoy.${table}`,
        `insert into pactjoy.${table} default values`,
        `update pactjoy.${table} set ${col?.attname} = ${col?.attname}`,
        `delete from pactjoy.${table}`,
        `truncate pactjoy.${table}`,
      ];
      for (const role of ROLES)
        for (const statement of statements)
          expect(await sqlstateAs(role, statement), `${role}: ${statement}`).toBe("42501");
    }
  });

  it("SS-S7: no grant on any table or sequence of pactjoy for client roles or PUBLIC", async () => {
    const grants = await admin`
      select grantee, table_name from information_schema.role_table_grants
      where table_schema = 'pactjoy' and grantee in ('anon', 'authenticated', 'PUBLIC')`;
    expect(grants).toEqual([]);
    const sequences = await admin`
      select c.relname, r.rolname,
        has_sequence_privilege(r.oid, c.oid, 'USAGE') or has_sequence_privilege(r.oid, c.oid, 'SELECT')
          or has_sequence_privilege(r.oid, c.oid, 'UPDATE') as held
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join pg_roles r
      where n.nspname = 'pactjoy' and c.relkind = 'S' and r.rolname in ('anon', 'authenticated')`;
    expect(sequences.length).toBeGreaterThan(0);
    expect(sequences.filter((row) => row.held)).toEqual([]);
  });

  it("SS-S8: no user-defined trigger or function, and no foreign key to auth", async () => {
    const triggers = await admin`
      select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'pactjoy' and not t.tgisinternal`;
    const functions = await admin`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'pactjoy'`;
    const authFks = await admin`
      select conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'pactjoy' and c.contype = 'f' and c.confrelid::regclass::text like 'auth.%'`;
    expect([...triggers, ...functions, ...authFks]).toEqual([]);
  });

  it("SS-S11: default privileges for new tables do not reach client roles", async () => {
    const rollback = new Error("rollback");
    await admin
      .begin(async (tx) => {
        await tx.unsafe("create table pactjoy.security_probe (id uuid)");
        for (const role of ROLES) {
          const [row] =
            await tx`select has_table_privilege(${role}, 'pactjoy.security_probe', 'SELECT') as ok`;
          expect(row?.ok, role).toBe(false);
        }
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
  });
});
