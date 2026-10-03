/**
 * The ONLY reader of `import.meta.env` in the client (guarded by test/boundary.test.ts).
 * Everything else receives the typed `AppConfig` from the composition root.
 */

export interface AppConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly apiBaseUrl: string;
}

type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  readonly missing: readonly string[];
  readonly invalid: readonly string[];

  constructor(missing: readonly string[], invalid: readonly string[]) {
    super(
      [
        missing.length > 0 ? `Missing: ${missing.join(", ")}` : null,
        invalid.length > 0 ? `Invalid: ${invalid.join(", ")}` : null,
      ]
        .filter((part) => part !== null)
        .join(". "),
    );
    this.name = "ConfigError";
    this.missing = missing;
    this.invalid = invalid;
  }
}

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, "");

export function loadConfig(env: Env): AppConfig {
  const missing: string[] = [];
  const invalid: string[] = [];

  const read = (name: string, kind: "url" | "text"): string => {
    const raw = env[name]?.trim() ?? "";
    if (raw === "") {
      missing.push(name);
      return "";
    }
    if (kind === "url") {
      if (!isHttpUrl(raw)) invalid.push(name);
      return stripTrailingSlashes(raw);
    }
    return raw;
  };

  const config: AppConfig = {
    supabaseUrl: read("VITE_SUPABASE_URL", "url"),
    supabaseAnonKey: read("VITE_SUPABASE_ANON_KEY", "text"),
    apiBaseUrl: read("VITE_API_BASE_URL", "url"),
  };

  if (missing.length > 0 || invalid.length > 0) throw new ConfigError(missing, invalid);
  return config;
}

/** Reads the build-time environment. Call it once, from the composition root. */
export function loadConfigFromEnv(): AppConfig {
  return loadConfig(import.meta.env);
}
