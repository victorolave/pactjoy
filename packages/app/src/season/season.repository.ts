import type { CircleId, SeasonId } from "../shared/ids.ts";
import type { Season } from "./season.ts";

/**
 * Storage port for {@link Season} (ADR-0008, D6). Tested through its
 * in-memory adapter (`testing/in-memory-season-repository.ts`), same
 * convention as `circle/circle.repository.ts`.
 */
export interface SeasonRepository {
  get(id: SeasonId): Promise<Season | null>;
  /**
   * The most recently created season for a circle, of any status, or
   * `null` if the circle has never had one. Used both for CM-12 (one
   * pact-open-or-active season per circle) and the join gate (B11,
   * derived in `join-circle.ts`): only the latest season can ever be
   * `"pactOpen"` or `"active"`, since creating a new one is rejected while
   * one of those exists.
   */
  findLatestByCircle(circleId: CircleId): Promise<Season | null>;
  /**
   * Read-set guard (D5) for a season this transaction only READ: at commit,
   * the transaction fails with `ConcurrencyConflict` if the stored version
   * is no longer `expectedVersion`. Has no effect outside a transaction.
   *
   * Adapters MUST make the check atomic with the transaction's own writes
   * (see `CircleRepository.guardVersion`): in Postgres, `SELECT ... FOR
   * SHARE` on the row when the guard is registered, or a version predicate
   * evaluated inside the commit. A guard on a missing id always fails.
   */
  guardVersion(id: SeasonId, expectedVersion: number): Promise<void>;
  /** @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion` (D5). */
  save(season: Season, expectedVersion: number | null): Promise<void>;
  /**
   * Discards a season outright (used when the last member leaves a circle
   * whose pact is still open, so nothing was ever agreed).
   * @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion` (D5).
   */
  delete(id: SeasonId, expectedVersion: number): Promise<void>;
}
