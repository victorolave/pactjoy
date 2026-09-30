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
  /** @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion` (D5). */
  save(circle: Circle, expectedVersion: number | null): Promise<void>;
}
