import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./db.ts";

/** The same files production applies with `supabase db push` (HM-R3). */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../supabase/migrations", import.meta.url),
);

/** Applies every `.sql` file in lexical order, each in its own transaction; names the failing file. */
export async function migrate(url: string, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const sql = connect(url);
  try {
    for (const file of files) {
      const text = await readFile(join(dir, file), "utf8");
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(text);
        });
      } catch (cause) {
        throw new Error(`migration ${file} failed: ${(cause as Error).message}`, { cause });
      }
    }
  } finally {
    await sql.end();
  }
  return files;
}

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["trigger", /\bcreate\s+(or\s+replace\s+)?(constraint\s+)?trigger\b/i],
  ["function", /\bcreate\s+(or\s+replace\s+)?function\b/i],
  ["procedure", /\bcreate\s+(or\s+replace\s+)?procedure\b/i],
  ["auth.", /\bauth\./i],
];

/** Constructs migrations must never use (no business logic in Postgres, no Supabase coupling). */
export function forbiddenConstructs(sql: string): string[] {
  const code = sql.replace(/--.*$/gm, "");
  return FORBIDDEN.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
}

let lastStamp = 0;

export interface FreshDatabase {
  readonly url: string;
  drop(): Promise<void>;
}

/** Creates and later drops its own `pactjoy_test_<pid>_<ts>` database; never touches the caller's. */
export async function createFreshDatabase(serverUrl: string): Promise<FreshDatabase> {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  const name = `pactjoy_test_${process.pid}_${lastStamp}`;
  const admin = connect(serverUrl);
  try {
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const dropper = connect(serverUrl);
      try {
        await dropper.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await dropper.end();
      }
    },
  };
}
