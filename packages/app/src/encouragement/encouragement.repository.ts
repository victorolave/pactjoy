import type { MemberId } from "@pactjoy/engine";
import type { EncouragementId, SeasonId } from "../shared/ids.ts";
import type { Encouragement } from "./encouragement.ts";

/**
 * Storage port for the {@link Encouragement} aggregate (ADR-0018, F14).
 *
 * Privacy is structural: an encouragement is readable only by its recipient (and its sender for
 * their own sends), so the port has NO season-wide read (no `listBySeason`) and a peer read cannot
 * even be expressed against it. `encouragement-guard.test.ts` also confines this port, and
 * `repos.encouragements`, to `src/encouragement/`. `get` is by id, for the push hook
 * (`encouragementNotice`), which already holds an id it was handed.
 */
export interface EncouragementRepository {
  /** The encouragements the member SENT in the season, oldest first (`sentAt`, ties by id). */
  listSent(seasonId: SeasonId, senderId: MemberId): Promise<readonly Encouragement[]>;
  /** The encouragements the member RECEIVED in the season, oldest first (`sentAt`, ties by id). */
  listReceived(seasonId: SeasonId, recipientId: MemberId): Promise<readonly Encouragement[]>;
  get(id: EncouragementId): Promise<Encouragement | null>;
  /**
   * Inserts the encouragement. Adapters make both unique keys atomic with the write:
   * `(seasonId, senderId, recipientId, caseWeek)` and `(senderId, recipientId, sentOn)`.
   * @throws {ConcurrencyConflict} if the id or either unique key already exists.
   */
  add(encouragement: Encouragement): Promise<void>;
  /**
   * Account erasure (ADR-0019): deletes every encouragement RECEIVED by `memberIds`. What they
   * SENT is kept, anonymous, unless its recipient is erased too. Reads nothing back. `[]` is a
   * no-op.
   */
  deleteByRecipients(memberIds: readonly MemberId[]): Promise<void>;
  /** Full-circle erasure: deletes every encouragement of `seasonIds`. `[]` is a no-op. */
  deleteBySeasons(seasonIds: readonly SeasonId[]): Promise<void>;
}
