/**
 * A point in time as epoch milliseconds (ADR-0009). The only way to get an
 * `Instant` in production is `Clock.now()`; tests build one directly with
 * this validating constructor, same brand pattern as `shared/ids.ts`.
 */
export type Instant = number & { readonly __brand: "Instant" };

/** @throws {RangeError} if `epochMs` is not a non-negative safe integer. */
export function instant(epochMs: number): Instant {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError(`instant: ${epochMs} is not a non-negative safe integer epoch-ms value`);
  }
  return epochMs as Instant;
}
