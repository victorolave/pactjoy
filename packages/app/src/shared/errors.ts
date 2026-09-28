/**
 * Thrown, not returned as a `Result` (ADR-0008, D3): infrastructure
 * failures that are not expected domain outcomes.
 */

/**
 * Raised by an aggregate repository's `save(aggregate, expectedVersion)`
 * when the stored version no longer matches `expectedVersion` (ADR-0008,
 * D5 -- optimistic concurrency on Circle/Habit/Season/Entry).
 */
export class ConcurrencyConflict extends Error {
  constructor(message = "Concurrency conflict: the aggregate was modified by another write") {
    super(message);
    this.name = "ConcurrencyConflict";
  }
}
