import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DB_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(DB_ROOT, "../..");
const SKIP = new Set(["node_modules", ".git", "dist", ".turbo", ".claude"]);

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

const sources = (dir: string) => files(dir, /\.(ts|tsx|mts)$/);

// Static, side-effect, dynamic and CommonJS imports of `postgres` or `postgres/<subpath>`.
const importsPostgres = (text: string) =>
  /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']postgres(?:\/[^"']*)?["']/.test(text);

describe("package boundary", () => {
  it("HM-S10: the index exports exactly the factory and its two types", async () => {
    const runtime = Object.keys(await import("../src/index.ts"));
    expect(runtime).toEqual(["createPostgresUnitOfWork"]);

    const declared = [
      ...readFileSync(join(DB_ROOT, "src/index.ts"), "utf8").matchAll(
        /^export (?:type|interface|function) (\w+)/gm,
      ),
    ].map((m) => m[1]);
    expect(declared.sort()).toEqual(
      ["PostgresUnitOfWork", "PostgresUnitOfWorkOptions", "createPostgresUnitOfWork"].sort(),
    );
    expect(readFileSync(join(DB_ROOT, "src/index.ts"), "utf8")).not.toMatch(/export\s*(\*|\{)/);
  });

  it("HM-S11: the index imports no driver and its types mention no driver type", () => {
    const index = readFileSync(join(DB_ROOT, "src/index.ts"), "utf8");
    expect(importsPostgres(index)).toBe(false);
    expect(index).not.toMatch(/\bpostgres\.|\bSql\b|\bSqlExecutor\b|\bTransactionSql\b/);
  });

  it("DC-S16: the import scan catches every import form of the driver", () => {
    for (const code of [
      'import postgres from "postgres";',
      "import type { Sql } from 'postgres';",
      'import "postgres";',
      'import postgres from "postgres/cjs/src/index.js";',
      'const sql = await import("postgres");',
      'const postgres = require("postgres");',
    ])
      expect(importsPostgres(code), code).toBe(true);
    for (const code of ['import x from "postgres-array";', 'import x from "./postgres.ts";'])
      expect(importsPostgres(code), code).toBe(false);
  });

  it("DC-S16: no other package declares the postgres driver as a dependency", () => {
    const offenders = files(REPO_ROOT, /^package\.json$/)
      .filter((file) => relative(REPO_ROOT, file) !== "packages/db/package.json")
      .filter((file) => {
        const manifest = JSON.parse(readFileSync(file, "utf8"));
        return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
          (field) => manifest[field]?.postgres !== undefined,
        );
      })
      .map((file) => relative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("SS-S9: no service-role key is referenced by the adapter or the migrations", () => {
    const scanned = [
      ...sources(join(DB_ROOT, "src")),
      ...files(resolve(REPO_ROOT, "supabase/migrations"), /\.sql$/),
    ];
    const offenders = scanned.filter((file) =>
      /service[_-]?role/i.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => relative(REPO_ROOT, file))).toEqual([]);
  });

  it("DC-S16: only packages/db imports the postgres driver, and in src only through client.ts", () => {
    const offenders = sources(REPO_ROOT)
      .filter((file) => importsPostgres(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file))
      .filter(
        (file) => !file.startsWith("packages/db/test/") && file !== "packages/db/src/client.ts",
      );
    expect(offenders).toEqual([]);
  });

  it("DC-S11: the UUID v7 adapter is portable (no node:, Deno or Math.random)", () => {
    const adapter = readFileSync(
      resolve(REPO_ROOT, "packages/app/src/adapters/uuid-v7-id-generator.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(adapter).not.toMatch(/node:|\bDeno\b|Math\.random/);
    expect(adapter).toMatch(/crypto\.getRandomValues/);
  });

  it("DC-S14: the pause stub is marked temporary with the A2 replacement note", () => {
    const stub = readFileSync(join(DB_ROOT, "src/pause/no-pause-request-reader.ts"), "utf8");
    expect(stub).toMatch(/TODO\(A2\)/);
    expect(stub).toMatch(/TEMPORARY/);
  });
});
