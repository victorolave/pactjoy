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

/**
 * Raised by `generate-invite.ts` when every attempt to draw a fresh
 * {@link InviteCode} (see `circle/invite-code.ts`) collided with another
 * circle's active invite code (extremely unlikely with a 31^6 code space,
 * but not impossible).
 */
export class InviteCodeGenerationFailed extends Error {
  constructor(message = "Could not generate a unique invite code after several attempts") {
    super(message);
    this.name = "InviteCodeGenerationFailed";
  }
}
