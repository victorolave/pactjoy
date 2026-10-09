/**
 * Where the dev seed writes, resolved from the environment (or the local `supabase status -o env`
 * output) and REFUSED unless every target is this machine. The service role key is only ever
 * held in memory for the run: never written, logged or committed.
 */

export interface SeedConfig {
  readonly supabaseUrl: string;
  readonly databaseUrl: string;
  readonly serviceRoleKey: string;
}

/** The local Supabase CLI defaults (`supabase start`); not secrets. */
const DEFAULT_SUPABASE_URL = "http://127.0.0.1:54321";
const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function isLocalUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `env` wins; `status` (the parsed `supabase status -o env`) fills the gaps; the CLI defaults
 * fill the URLs. Returns a message instead of a config when anything is missing or not local.
 */
export function resolveConfig(env: Env, status: Env = {}): SeedConfig | string {
  const supabaseUrl = env.SEED_SUPABASE_URL ?? status.API_URL ?? DEFAULT_SUPABASE_URL;
  const databaseUrl = env.SEED_DATABASE_URL ?? status.DB_URL ?? DEFAULT_DATABASE_URL;
  const serviceRoleKey = env.SEED_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY ?? "";
  if (!isLocalUrl(supabaseUrl) || !isLocalUrl(databaseUrl)) {
    return "Refusing to seed: Supabase and the database must be local (127.0.0.1 or localhost).";
  }
  if (serviceRoleKey === "") {
    return "Missing the LOCAL service role key: run `supabase start`, then export SEED_SERVICE_ROLE_KEY from `supabase status -o env` (see packages/db/README.md).";
  }
  return { supabaseUrl, databaseUrl, serviceRoleKey };
}

/** Parses `KEY="value"` lines (the `supabase status -o env` format). */
export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) out[match[1]] = match[2];
  }
  return out;
}
