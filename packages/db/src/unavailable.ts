/**
 * Node socket errors and the driver's own connection codes. These are plain
 * string `code` fields, so no driver type is needed to recognise them.
 */
const CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ECONNRESET",
  "EPIPE",
  "ECONNABORTED",
  "ENETUNREACH",
  "ENETDOWN",
  "EAI_AGAIN",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
]);

/**
 * SQLSTATEs where the server is up but cannot serve us right now: too many
 * connections (53300) and admin shutdown / crash shutdown / cannot connect now
 * (57P01-57P03), plus the connection exceptions 08000/08001/08003/08004/08006.
 * An explicit list, not a prefix: 08P01 (protocol violation) is a bug, not an outage.
 */
const UNAVAILABLE_SQLSTATES: ReadonlySet<string> = new Set([
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
]);

/** How many wrapper levels (`cause` / AggregateError members) are inspected. */
const MAX_DEPTH = 3;

function matches(error: unknown, depth: number, seen: Set<unknown>): boolean {
  if (typeof error !== "object" || error === null || seen.has(error)) return false;
  seen.add(error);
  const { code, cause, errors } = error as Record<string, unknown>;
  if (typeof code === "string" && (CONNECTION_CODES.has(code) || UNAVAILABLE_SQLSTATES.has(code)))
    return true;
  if (depth >= MAX_DEPTH) return false;
  const children = Array.isArray(errors) ? [cause, ...errors] : [cause];
  return children.some((child) => matches(child, depth + 1, seen));
}

/**
 * True when `error` means "the database cannot be reached or cannot accept
 * work right now", so a caller may answer 503 and let the client retry. Any
 * other failure (constraint violations, bad input, bugs) is false. Duck-typed
 * on `code`, unwrapping `cause` and AggregateError members (depth 3): no vendor type leaks, and the API layer carries no SQLSTATE
 * knowledge (design, change api-edge-function-auth).
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  return matches(error, 0, new Set());
}
