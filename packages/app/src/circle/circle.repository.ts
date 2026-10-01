import type { CircleId, UserId } from "../shared/ids.ts";
import type { Circle } from "./circle.ts";

/**
 * Storage port for {@link Circle} (ADR-0008, D6). Tested through its
 * in-memory adapter (`testing/in-memory-circle-repository.ts`), same
 * convention as `ports/id-generator.ts`/`ports/random-source.ts` -- the
 * interface alone has no runtime behavior of its own.
 *
 * Invariant every adapter and writer must preserve: a circle with
 * `archivedAt === null` has at least one active member, and only
 * `leaveCircle` archives it (in the same commit as the last leave).
 * Nothing un-archives; `save` must never persist a non-archived circle
 * with zero active members.
 *
 * Ordering contract: `Circle.members` MUST come back in a STABLE order
 * (e.g. by join time, then id), the same on every read. Standings break
 * ties by input order (engine decision Q2: no secondary tiebreaker), so an
 * adapter that returns members in arbitrary order makes tied members swap
 * places between calls.
 */
export interface CircleRepository {
  get(id: CircleId): Promise<Circle | null>;
  /**
   * `code` must already be normalized (see `invite-code.ts`'s `normalizeInviteCode`).
   * Invite codes are globally unique across ALL circles, expired ones
   * included: an adapter enforcing that with a unique constraint reports a
   * collision on `save` as `ConcurrencyConflict`. Reusing an EXPIRED code
   * is astronomically rare, so that divergence from the in-memory adapter
   * (which only rejects active collisions) is accepted (ADR-0010).
   * `generateInvite` does not retry that collision (it only pre-checks for
   * an active one), so the caller sees the conflict and the client retries.
   */
  findByInviteCode(code: string): Promise<Circle | null>;
  /** The circle `userId` is currently an active member of, if any (A5, CM-11). */
  findActiveByUser(userId: UserId): Promise<Circle | null>;
  /**
   * Read-set guard (D5) for a circle this transaction only READ: at commit,
   * the transaction fails with `ConcurrencyConflict` if the stored version
   * is no longer `expectedVersion`. Has no effect outside a transaction.
   *
   * Adapters MUST make the check atomic with the transaction's own writes:
   * a version that changes between the check and the commit would defeat
   * the guard. In Postgres that requires a LOCKING read taken when the
   * guard is registered and held until commit: ALWAYS
   * `SELECT ... FOR NO KEY UPDATE`, NEVER `FOR SHARE` (a share lock later
   * upgraded by this transaction's own UPDATE deadlocks when two
   * transactions do it at once). It conflicts with any concurrent writer or
   * guard of the row, yet does not block the KEY SHARE locks foreign-key
   * checks take. Saves must therefore never update key columns. A bare
   * version check without a lock is NOT enough. Map Postgres deadlocks
   * (40P01) to `ConcurrencyConflict`.
   * A guard on a missing id always fails. Guarding and saving the same
   * aggregate in one transaction is allowed: the guard is checked against
   * the version as it was BEFORE this transaction's own write.
   */
  guardVersion(id: CircleId, expectedVersion: number): Promise<void>;
  /** @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion` (D5). */
  save(circle: Circle, expectedVersion: number | null): Promise<void>;
}
