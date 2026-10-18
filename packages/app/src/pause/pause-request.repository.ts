import type { MemberId, PauseRequest } from "@pactjoy/engine";
import type { PauseRequestId, SeasonId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { PauseRequestRecord } from "./pause-request.ts";

/** A {@link PauseRequest} plus the member who owns it: what the engine is fed, one per Commitment. */
export type MemberPauseRequest = PauseRequest & { readonly memberId: MemberId };

/**
 * Storage port for the {@link PauseRequestRecord} aggregate (ADR-0013). The
 * root and its children (commitments, responses) are saved and read as one.
 * What it returns is the PERSISTED state: a use case or query must never act
 * on it directly but go through `loadEffectivePauses` (the choke point,
 * guarded by `choke-point.test.ts`), which applies the lazy decision.
 */
export interface PauseRequestRepository {
  get(id: PauseRequestId): Promise<PauseRequestRecord | null>;
  /** Every request of the season, in creation order. */
  listBySeason(seasonId: SeasonId): Promise<readonly PauseRequestRecord[]>;
  /** Pending requests whose `autoApproveAt` is at or before `now`, across seasons, in creation order. */
  listDue(now: Instant): Promise<readonly PauseRequestRecord[]>;
  /**
   * Inserts (`expectedVersion` null) or updates the record, replacing its
   * children wholesale. Adapters never update key columns and, on Postgres,
   * make the version check atomic with the write.
   * @throws {ConcurrencyConflict} if the stored version no longer matches `expectedVersion`
   * (or, for an insert, the id already exists).
   */
  save(record: PauseRequestRecord, expectedVersion: number | null): Promise<void>;
  /**
   * Full-circle erasure: deletes every request of `seasonIds`, commitments and responses included.
   * `[]` is a no-op. A member's own erasure never deletes a request (peers' scoring depends on it):
   * it blanks the details through a normal `save` (`eraseMemberPauseDetails`).
   */
  deleteBySeasons(seasonIds: readonly SeasonId[]): Promise<void>;
}
