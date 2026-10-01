/**
 * Logger port. Callers must never pass tokens, bodies, notes, invite codes or user ids;
 * the console adapter drops those field names as a second line of defence.
 */
export interface Logger {
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

const MAX_STRING = 200;

/** Normalized (lower-case, `_`/`-` stripped) substrings: any key containing one is dropped. */
const SENSITIVE_PARTS = [
  "token",
  "auth",
  "password",
  "secret",
  "cookie",
  "invitecode",
  "userid",
  "email",
  "databaseurl",
  "connectionstring",
  "dsn",
  "apikey",
  "jwt",
];

/** Exact (normalized) names too generic for substring matching. Driver errors carry row data. */
const SENSITIVE_EXACT = new Set(["body", "note", "detail", "where"]);

const isSensitiveKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return SENSITIVE_EXACT.has(normalized) || SENSITIVE_PARTS.some((p) => normalized.includes(p));
};

/** Masks credentials that can hide inside free text (driver and URL errors echo them). */
const scrub = (value: string): string =>
  value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]*@/gi, "$1***@")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/eyJ[\w-]*(?:\.[\w-]*){0,2}/g, "***");

/** Scrubbing runs first: truncating first could cut a credential in half and defeat the patterns. */
const sanitize = (value: string): string => truncate(scrub(value));

const truncate = (value: string): string =>
  value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;

function safeJson(record: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(record, function (this: unknown, key: string, value: unknown) {
    if (key !== "" && isSensitiveKey(key)) return undefined;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") return sanitize(value);
    if (value instanceof Error) {
      return { name: value.name, message: sanitize(value.message) };
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
}

/**
 * One JSON line per event. The sink defaults to `console.log` (the Edge runtime captures
 * stdout); tests inject their own. Never throws: logging must not break a request.
 */
export function createConsoleLogger(
  write: (line: string) => void = (line) => console.log(line),
): Logger {
  const emit = (
    level: "warn" | "error",
    event: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => {
    try {
      write(safeJson({ ...fields, level, event }));
    } catch {
      try {
        write(JSON.stringify({ level, event, logFailure: true }));
      } catch {
        // Nothing left to do: a logger must never take the request down with it.
      }
    }
  };
  return {
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
