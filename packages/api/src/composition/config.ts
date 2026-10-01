import { err, ok, type Result } from "@pactjoy/app";

/** Validated production configuration (ADR-0011). `databaseUrl` is a secret: never log it. */
export interface ApiEnv {
  readonly databaseUrl: string;
  /** Without a trailing slash. */
  readonly supabaseUrl: string;
  readonly jwksUrl: string;
  readonly jwtIssuer: string;
  /** Exact origins; empty allows no browser origin (Q5 default). */
  readonly allowedOrigins: readonly string[];
}

/** Variable NAMES only: a value never appears in an error (AC-R5). */
export interface ApiEnvError {
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
}

const isHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const isPostgresUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "postgres:" || protocol === "postgresql:";
  } catch {
    return false;
  }
};

/** A base URL gets paths appended, so a query or fragment would corrupt every derived URL. */
const isBaseUrl = (value: string): boolean => {
  if (!isHttpUrl(value)) return false;
  const url = new URL(value);
  return url.search === "" && url.hash === "" && !value.includes("?") && !value.includes("#");
};

const isExactOrigin = (value: string): boolean => {
  try {
    // WHATWG URL accepts `*` in a host, so wildcards must be refused explicitly.
    return !value.includes("*") && isHttpUrl(value) && new URL(value).origin === value;
  } catch {
    return false;
  }
};

/**
 * Reads the configuration through an injected getter (no `process`/Deno access here, so the
 * package stays runtime-agnostic). Blank counts as unset. Reports every problem at once.
 */
export function loadApiEnv(get: (name: string) => string | undefined): Result<ApiEnv, ApiEnvError> {
  const read = (name: string): string | undefined => {
    const value = get(name)?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  const missing: string[] = [];
  const invalid: string[] = [];

  const databaseUrl = read("API_DATABASE_URL");
  if (databaseUrl === undefined) missing.push("API_DATABASE_URL");
  else if (!isPostgresUrl(databaseUrl)) invalid.push("API_DATABASE_URL");

  const rawSupabase = read("SUPABASE_URL");
  let supabaseUrl: string | undefined;
  if (rawSupabase === undefined) missing.push("SUPABASE_URL");
  else if (isBaseUrl(rawSupabase)) supabaseUrl = rawSupabase.replace(/\/+$/, "");
  else invalid.push("SUPABASE_URL");

  const rawIssuer = read("API_JWT_ISSUER");
  if (rawIssuer !== undefined && (!isHttpUrl(rawIssuer) || rawIssuer.endsWith("/")))
    invalid.push("API_JWT_ISSUER");

  const rawOrigins = read("ALLOWED_ORIGINS");
  const origins = rawOrigins === undefined ? [] : rawOrigins.split(",").map((o) => o.trim());
  if (!origins.every(isExactOrigin)) invalid.push("ALLOWED_ORIGINS");

  if (
    missing.length > 0 ||
    invalid.length > 0 ||
    databaseUrl === undefined ||
    supabaseUrl === undefined
  ) {
    return err({ missing, invalid });
  }
  return ok({
    databaseUrl,
    supabaseUrl,
    jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    jwtIssuer: rawIssuer ?? `${supabaseUrl}/auth/v1`,
    allowedOrigins: origins,
  });
}

/** A message safe to log or throw: variable names only. */
export function describeEnvError(error: ApiEnvError): string {
  const parts = [
    ...(error.missing.length > 0 ? [`missing: ${error.missing.join(", ")}`] : []),
    ...(error.invalid.length > 0 ? [`invalid: ${error.invalid.join(", ")}`] : []),
  ];
  return `Invalid API configuration (${parts.join("; ")})`;
}
