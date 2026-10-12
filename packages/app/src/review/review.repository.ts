import type { MemberId } from "@pactjoy/engine";
import type { SeasonId } from "../shared/ids.ts";
import type { ReviewRecord } from "./review.ts";

/**
 * Storage port for the {@link ReviewRecord} aggregate. The root and its children (one automaticity
 * response per Commitment) are saved and read as one.
 *
 * Privacy is structural: reviews, reflections and SRBAI answers are readable only by their owner,
 * so the port has NO season-wide read (no `listBySeason`) and a peer read cannot even be expressed
 * against it. `review-guard.test.ts` also confines this port, and `repos.reviews`, to `src/review/`.
 */
export interface ReviewRepository {
  /** The member's own reviews of the season (baseline included), by `periodIndex`. */
  listMine(seasonId: SeasonId, memberId: MemberId): Promise<readonly ReviewRecord[]>;
  /**
   * Inserts (`expectedVersion` null) or updates the record, replacing its children wholesale.
   * Reviews are insert-only in practice; the shape matches the other aggregates. Adapters make the
   * `(seasonId, memberId, periodIndex)` uniqueness atomic with the write, which is what keeps a
   * double submit to one stored review.
   * @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion`, or,
   * for an insert, the id or the `(seasonId, memberId, periodIndex)` key already exists.
   */
  save(record: ReviewRecord, expectedVersion: number | null): Promise<void>;
}
