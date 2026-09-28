/**
 * Bounded random integers (ADR-0008, D9). Used where a use case needs
 * randomness (e.g. picking invite-code characters) without depending on
 * `Math.random` or a runtime-specific `crypto` directly.
 */
export interface RandomSource {
  /** Returns an integer in `[0, boundExclusive)`. */
  int(boundExclusive: number): number;
}
