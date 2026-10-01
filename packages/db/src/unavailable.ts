/**
 * Node socket errors and the driver's own connection codes. These are plain
 * string `code` fields, so no driver type is needed to recognise them.
 */
const CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
]);

/**
 * SQLSTATEs where the server is up but cannot serve us right now: too many
 * connections (53300) and admin shutdown / crash shutdown / cannot connect now
 * (57P01-57P03). Class 08 (connection exception) is matched by prefix.
 */
const UNAVAILABLE_SQLSTATES: ReadonlySet<string> = new Set(["53300", "57P01", "57P02", "57P03"]);

/**
 * True when `error` means "the database cannot be reached or cannot accept
 * work right now", so a caller may answer 503 and let the client retry. Any
 * other failure (constraint violations, bad input, bugs) is false. Duck-typed
 * on `code`: no vendor type leaks, and the API layer carries no SQLSTATE
 * knowledge (design, change api-edge-function-auth).
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as Record<string, unknown>).code;
  if (typeof code !== "string") return false;
  return CONNECTION_CODES.has(code) || UNAVAILABLE_SQLSTATES.has(code) || code.startsWith("08");
}
