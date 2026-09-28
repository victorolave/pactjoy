/**
 * Typed outcome for EXPECTED domain failures (ADR-0008, D3). Use cases and
 * queries return `Result<T, E>` for anything a caller must branch on --
 * validation, not-found, business-rule rejection. Throw only for bugs or
 * infra failures (e.g. `ConcurrencyConflict`, see `shared/errors.ts`).
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Builds the success branch of a {@link Result}. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Builds the failure branch of a {@link Result}. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
