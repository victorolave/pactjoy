import type { MemberId } from "@pactjoy/engine";
import type { SeasonId } from "../../shared/ids.ts";
import type { SeasonClosure } from "./season-closure.ts";

/**
 * Storage port for the {@link SeasonClosure} aggregate. The root and its children (one decision
 * per Commitment) are saved and read as one.
 *
 * Decisions are private to their owner, so the port has NO season-wide read of decisions. The one
 * season-wide read is `closedMemberIds`: member ids ONLY (no decisions, no dates), which the
 * lifecycle rule needs to know who has closed. `closure-guard.test.ts` confines this port, and
 * `repos.seasonClosures`, to `src/season/closure/`.
 */
export interface SeasonClosureRepository {
  /** The member's own closure of the season, or `null` if they have not closed yet. */
  getMine(seasonId: SeasonId, memberId: MemberId): Promise<SeasonClosure | null>;
  /** Who has closed the season: ids only, never decisions. For the finalization rule. */
  closedMemberIds(seasonId: SeasonId): Promise<readonly MemberId[]>;
  /**
   * Inserts (`expectedVersion` null) or updates the closure, replacing its children wholesale.
   * Closures are insert-only in practice; the shape matches the other aggregates. Adapters make
   * the `(seasonId, memberId)` uniqueness atomic with the write, which is what keeps a double
   * submit to one stored closure.
   * @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion`, or,
   * for an insert, the id or the `(seasonId, memberId)` key already exists.
   */
  save(closure: SeasonClosure, expectedVersion: number | null): Promise<void>;
  /** Account erasure: delete private closures and child decisions; caller holds circle/season guards. */
  deleteByMembers(memberIds: readonly MemberId[]): Promise<void>;
  /** Full-circle erasure; child decisions cascade. Empty input is a no-op. */
  deleteBySeasons(seasonIds: readonly SeasonId[]): Promise<void>;
}
