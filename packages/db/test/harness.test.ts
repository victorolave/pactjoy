import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { databaseUrl, queryOne } from "./db.ts";
import { createFreshDatabase, forbiddenConstructs, MIGRATIONS_DIR, migrate } from "./migrate.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function freshDatabase() {
  const fresh = await createFreshDatabase(databaseUrl());
  cleanups.push(fresh.drop);
  return fresh;
}

async function migrationsDir(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "pactjoy-migrations-"));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

describe("harness database", () => {
  it("HM-S3: runs Postgres 17", async () => {
    const row = await queryOne<{ major: number }>(
      databaseUrl(),
      "select current_setting('server_version_num')::int / 10000 as major",
    );

    expect(row.major).toBe(17);
  });

  it("HM-S6: the migrations created schema pactjoy and closed it to client roles", async () => {
    const row = await queryOne(
      databaseUrl(),
      `select exists (select 1 from pg_namespace where nspname = 'pactjoy') as found,
              has_schema_privilege('anon', 'pactjoy', 'usage') as anon,
              has_schema_privilege('authenticated', 'pactjoy', 'usage') as authed`,
    );

    expect(row).toEqual({ found: true, anon: false, authed: false });
  });
});

describe("migration files", () => {
  it("HM-S7: real migrations contain no trigger, function, procedure or auth reference", async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      expect({ file, found: forbiddenConstructs(text) }).toEqual({ file, found: [] });
    }
  });

  it("HM-S7: the scanner flags each forbidden construct and ignores comments", () => {
    expect(forbiddenConstructs("CREATE TRIGGER t before insert on x")).toEqual(["trigger"]);
    expect(forbiddenConstructs("create or replace function f()")).toEqual(["function"]);
    expect(forbiddenConstructs("create procedure p()")).toEqual(["procedure"]);
    expect(forbiddenConstructs("select auth.uid()")).toEqual(["auth."]);
    expect(forbiddenConstructs("-- create trigger is forbidden\nselect 1")).toEqual([]);
  });
});

describe("migrate", () => {
  it("applies files in lexical order, one transaction each", async () => {
    const fresh = await freshDatabase();
    const dir = await migrationsDir({
      "0002_add.sql": "insert into t values (2);",
      "0001_create.sql": "create table t (n int); insert into t values (1);",
      "0003_add.sql": "insert into t values (3);",
    });

    const applied = await migrate(fresh.url, dir);

    const row = await queryOne(fresh.url, "select array_agg(n order by ctid) as ns from t");
    expect(applied).toEqual(["0001_create.sql", "0002_add.sql", "0003_add.sql"]);
    expect(row).toEqual({ ns: [1, 2, 3] });
  });

  it("names the failing file and rolls back only that file", async () => {
    const fresh = await freshDatabase();
    const dir = await migrationsDir({
      "0001_ok.sql": "create table ok (n int);",
      "0002_bad.sql": "create table half (n int); select * from does_not_exist;",
    });

    await expect(migrate(fresh.url, dir)).rejects.toThrow(/0002_bad\.sql/);

    const row = await queryOne(
      fresh.url,
      "select to_regclass('ok')::text as ok, to_regclass('half')::text as half",
    );
    expect(row).toEqual({ ok: "ok", half: null });
  });
});

describe("fresh database per run", () => {
  it("HM-S8: each call gets its own database and leaves the source untouched", async () => {
    await queryOne(databaseUrl(), "create table harness_marker (n int)");
    cleanups.push(async () => {
      await queryOne(databaseUrl(), "drop table harness_marker");
    });

    const a = await freshDatabase();
    const b = await freshDatabase();

    expect(new URL(a.url).pathname).toMatch(/^\/pactjoy_test_\d+_\d+$/);
    expect(a.url).not.toBe(b.url);
    const row = await queryOne(a.url, "select to_regclass('harness_marker')::text as marker");
    expect(row).toEqual({ marker: null });
  });
});
