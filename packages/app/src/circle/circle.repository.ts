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
 */
export interface CircleRepository {
  get(id: CircleId): Promise<Circle | null>;
  /** `code` must already be normalized (see `invite-code.ts`'s `normalizeInviteCode`). */
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
   * the guard. In Postgres that means either `SELECT ... FOR SHARE` on the
   * row when the guard is registered (held until commit), or a version
   * predicate evaluated inside the commit itself (e.g. a
   * `WHERE id = $1 AND version = $2` check that fails the transaction when
   * it matches no row). A guard on a missing id always fails. Guarding and
   * saving the same aggregate in one transaction is allowed: the guard is
   * checked against the version as it was BEFORE this transaction's own
   * write.
   */
  guardVersion(id: CircleId, expectedVersion: number): Promise<void>;
  /** @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion` (D5). */
  save(circle: Circle, expectedVersion: number | null): Promise<void>;
}
