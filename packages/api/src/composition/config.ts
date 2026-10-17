import { err, ok, type Result } from "@pactjoy/app";

/**
 * Object storage for photo evidence (ADR-0016). Its shape is what the S3 adapter takes, so the
 * shell passes it on as it is. `secretAccessKey` is a secret: never log it.
 */
export interface StorageEnv {
  /** Where THIS process reaches storage; no trailing slash. */
  readonly endpoint: string;
  /** What the browser reaches (the https tunnel for a phone); defaults to `endpoint`. */
  readonly publicEndpoint?: string;
  /** `host[:port]` to sign server calls for, when it differs from `endpoint` (local Supabase: `kong:54321`). */
  readonly signingHost?: string;
  /** `host[:port]` to sign browser URLs for, when it differs from `publicEndpoint` (tunnel: `<host>:54321`). */
  readonly publicSigningHost?: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

/**
 * The VAPID key pair and contact for Web Push (ADR-0017). Its shape is what the push adapter
 * takes. `privateKey` is a secret: never log it.
 */
export interface PushEnv {
  /** base64url uncompressed P-256 point (87 characters). */
  readonly publicKey: string;
  /** base64url scalar `d` (43 characters). */
  readonly privateKey: string;
  /** `mailto:` or `https:` contact for push service operators. */
  readonly subject: string;
}

/** Validated production configuration (ADR-0011). `databaseUrl` is a secret: never log it. */
export interface ApiEnv {
  readonly databaseUrl: string;
  /** Without a trailing slash. */
  readonly supabaseUrl: string;
  readonly jwksUrl: string;
  readonly jwtIssuer: string;
  /** Exact origins; empty allows no browser origin (Q5 default). */
  readonly allowedOrigins: readonly string[];
  readonly storage: StorageEnv;
  /** `API_JOBS_SECRET` (32+ characters); `null` leaves the job routes unmounted. A secret. */
  readonly jobsSecret: string | null;
  /** `API_PUSH_VAPID_*`, all three or none; `null` turns Web Push off. */
  readonly push: PushEnv | null;
}

const MIN_JOBS_SECRET_LENGTH = 32;
const VAPID_PUBLIC_KEY = /^B[A-Za-z0-9_-]{86}$/;
const VAPID_PRIVATE_KEY = /^[A-Za-z0-9_-]{43}$/;
const isVapidSubject = (value: string): boolean =>
  /^mailto:\S+@\S+$/.test(value) || (isHttpUrl(value) && value.startsWith("https://"));

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

/** `host` or `host:port`, no scheme, path or userinfo. */
const isHostPort = (value: string): boolean =>
  /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$/.test(value);

/** A bucket name is a plain token: it is joined into a path, so no slash or space. */
const isBucketName = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);

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

  const baseUrlOf = (name: string, required: boolean): string | undefined => {
    const raw = read(name);
    if (raw === undefined) {
      if (required) missing.push(name);
      return undefined;
    }
    if (!isBaseUrl(raw)) {
      invalid.push(name);
      return undefined;
    }
    return raw.replace(/\/+$/, "");
  };
  const hostOf = (name: string): string | undefined => {
    const raw = read(name);
    if (raw === undefined) return undefined;
    if (!isHostPort(raw)) {
      invalid.push(name);
      return undefined;
    }
    return raw;
  };
  const required = (name: string, isValid: (value: string) => boolean = () => true) => {
    const raw = read(name);
    if (raw === undefined) missing.push(name);
    else if (!isValid(raw)) invalid.push(name);
    return raw;
  };
  const s3Endpoint = baseUrlOf("API_STORAGE_S3_ENDPOINT", true);
  const s3PublicEndpoint = baseUrlOf("API_STORAGE_S3_PUBLIC_ENDPOINT", false);
  const s3SigningHost = hostOf("API_STORAGE_S3_SIGNING_HOST");
  const s3PublicSigningHost = hostOf("API_STORAGE_S3_PUBLIC_SIGNING_HOST");
  const s3Region = required("API_STORAGE_S3_REGION");
  const s3AccessKeyId = required("API_STORAGE_S3_ACCESS_KEY_ID");
  const s3SecretAccessKey = required("API_STORAGE_S3_SECRET_ACCESS_KEY");
  const s3Bucket = required("API_STORAGE_BUCKET", isBucketName);

  const jobsSecret = read("API_JOBS_SECRET");
  if (jobsSecret !== undefined && jobsSecret.length < MIN_JOBS_SECRET_LENGTH) {
    invalid.push("API_JOBS_SECRET");
  }

  // The VAPID group: all three or none. Each variable is read once.
  const pushGroup = [
    ["API_PUSH_VAPID_PUBLIC_KEY", (v: string) => VAPID_PUBLIC_KEY.test(v)],
    ["API_PUSH_VAPID_PRIVATE_KEY", (v: string) => VAPID_PRIVATE_KEY.test(v)],
    ["API_PUSH_VAPID_SUBJECT", isVapidSubject],
  ] as const;
  const pushRaw = pushGroup.map(([name]) => read(name));
  const anyPush = pushRaw.some((value) => value !== undefined);
  const [vapidPublicKey, vapidPrivateKey, vapidSubject] = pushGroup.map(([name, isValid], i) => {
    const raw = pushRaw[i];
    if (!anyPush) return undefined;
    if (raw === undefined) missing.push(name);
    else if (!isValid(raw)) invalid.push(name);
    return raw;
  });

  if (
    missing.length > 0 ||
    invalid.length > 0 ||
    databaseUrl === undefined ||
    supabaseUrl === undefined ||
    s3Endpoint === undefined ||
    s3Region === undefined ||
    s3AccessKeyId === undefined ||
    s3SecretAccessKey === undefined ||
    s3Bucket === undefined
  ) {
    return err({ missing, invalid });
  }
  return ok({
    databaseUrl,
    supabaseUrl,
    jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    jwtIssuer: rawIssuer ?? `${supabaseUrl}/auth/v1`,
    allowedOrigins: origins,
    storage: {
      endpoint: s3Endpoint,
      ...(s3PublicEndpoint === undefined ? {} : { publicEndpoint: s3PublicEndpoint }),
      ...(s3SigningHost === undefined ? {} : { signingHost: s3SigningHost }),
      ...(s3PublicSigningHost === undefined ? {} : { publicSigningHost: s3PublicSigningHost }),
      region: s3Region,
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
      bucket: s3Bucket,
    },
    jobsSecret: jobsSecret ?? null,
    push:
      vapidPublicKey !== undefined && vapidPrivateKey !== undefined && vapidSubject !== undefined
        ? { publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject }
        : null,
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
