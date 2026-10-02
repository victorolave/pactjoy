import { ConcurrencyConflict } from "@pactjoy/app";

/**
 * Unique constraints whose violation means "another writer got there first":
 * a duplicate id on insert, a taken invite code, a replayed client request.
 * Every constraint is named explicitly in the migrations; this set keys on
 * those names (design section 4). `circle_invites_code_key` also fires for an
 * expired code that is reused: that surfaces as ConcurrencyConflict and the
 * client retries (decisions-schema, ADR-0010).
 * `circle_members_active_user_key` fires when two writers give one user an
 * active membership at once (A5): the loser gets ConcurrencyConflict, matched
 * by constraint name only, never retried.
 */
const CONFLICT_CONSTRAINTS: ReadonlySet<string> = new Set([
  "habits_pkey",
  "circles_pkey",
  "circle_invites_code_key",
  "seasons_pkey",
  "entries_pkey",
  "entries_client_request_key",
  "circle_members_active_user_key",
]);

const DEADLOCK_DETECTED = "40P01";
const SERIALIZATION_FAILURE = "40001";
const UNIQUE_VIOLATION = "23505";

/** Duck-typed on the driver's error fields, so no vendor type leaks. */
function field(error: unknown, name: "code" | "constraint_name"): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * True only for failures raised BY POSTGRES that a fresh attempt can win:
 * deadlock and serialization failure. A version-mismatch ConcurrencyConflict
 * is never retryable: the loser must lose.
 */
export function isRetryable(error: unknown): boolean {
  const code = field(error, "code");
  return code === DEADLOCK_DETECTED || code === SERIALIZATION_FAILURE;
}

/**
 * The error to throw to the caller. Lost races become `ConcurrencyConflict`
 * (retryables map here too, for use after the attempts are exhausted). Every
 * other failure (other constraints, 25006, 25P02, 42P01, ...) is a bug or a
 * caller error and is returned untouched so it surfaces as-is.
 */
export function mapError(error: unknown): unknown {
  if (isRetryable(error)) return new ConcurrencyConflict();
  const constraint = field(error, "constraint_name");
  if (
    field(error, "code") === UNIQUE_VIOLATION &&
    constraint !== undefined &&
    CONFLICT_CONSTRAINTS.has(constraint)
  ) {
    return new ConcurrencyConflict();
  }
  return error;
}
