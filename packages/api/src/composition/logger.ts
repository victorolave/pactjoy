/**
 * Logger port. Callers must never pass tokens, bodies, notes, invite codes or user ids;
 * the console adapter drops those field names as a second line of defence.
 */
export interface Logger {
  warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

const MAX_STRING = 200;

/** Lower-cased field names that must never reach a log line (ADR-0011, design 6). */
const SENSITIVE = new Set([
  "authorization",
  "token",
  "accesstoken",
  "body",
  "note",
  "invitecode",
  "userid",
  "email",
  "databaseurl",
  "api_database_url",
  "apikey",
  "password",
  "secret",
  // Driver errors carry row data in these.
  "detail",
  "where",
]);

const truncate = (value: string): string =>
  value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;

function safeJson(record: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(record, function (this: unknown, key: string, value: unknown) {
    if (key !== "" && SENSITIVE.has(key.toLowerCase())) return undefined;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") return truncate(value);
    if (value instanceof Error) {
      return { name: value.name, message: truncate(value.message) };
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
