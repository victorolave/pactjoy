import postgres from "postgres";

export const NEEDS_POSTGRES =
  "packages/db tests need Postgres: start Docker or set TEST_DATABASE_URL";

export interface StartedContainer {
  readonly url: string;
  stop(): Promise<void>;
}

export interface TestDatabase {
  readonly url: string;
  /** True when the caller owns the server: the harness must not wipe it. */
  readonly fromEnv: boolean;
  stop(): Promise<void>;
}

export interface DbSourceDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly startContainer: () => Promise<StartedContainer>;
  readonly probe?: (url: string) => Promise<void>;
}

/** Rejects with the driver's error when the server does not answer `select 1`. */
export async function connectProbe(url: string): Promise<void> {
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
  try {
    await sql`select 1`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/**
 * Picks the database for the db tests (HM-R1, HM-R2): `TEST_DATABASE_URL`
 * when set, otherwise a container. There is no skip: if neither works this
 * rejects and the run fails. Errors name the host only, never the credentials.
 */
export async function resolveTestDatabase(deps: DbSourceDeps): Promise<TestDatabase> {
  const provided = deps.env.TEST_DATABASE_URL?.trim();
  if (provided) {
    try {
      await (deps.probe ?? connectProbe)(provided);
    } catch {
      throw new Error(`${NEEDS_POSTGRES} (cannot reach host ${hostOf(provided)})`);
    }
    return { url: provided, fromEnv: true, stop: async () => {} };
  }
  try {
    const started = await deps.startContainer();
    return { url: started.url, fromEnv: false, stop: () => started.stop() };
  } catch (cause) {
    throw new Error(NEEDS_POSTGRES, { cause });
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(TEST_DATABASE_URL is not a valid URL)";
  }
}
