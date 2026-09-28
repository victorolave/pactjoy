import type { UserId } from "./ids.ts";

/**
 * The authenticated caller of a use case (ADR-0008, D11). Plain id, not an
 * auth port -- authentication itself lives in an adapter outside this
 * package; every use case just receives the resolved `Actor`.
 */
export interface Actor {
  readonly userId: UserId;
}
