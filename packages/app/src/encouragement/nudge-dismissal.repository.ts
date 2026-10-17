import type { MemberId } from "@pactjoy/engine";
import type { SeasonId } from "../shared/ids.ts";
import type { NudgeDismissal } from "./encouragement.ts";

/**
 * Storage port for {@link NudgeDismissal} (ADR-0018, F15). A dismissal is readable only by the
 * viewer who made it, so the port has NO season-wide read: `listMine` takes the viewer.
 * `encouragement-guard.test.ts` confines this port, and `repos.nudgeDismissals`, to
 * `src/encouragement/`.
 */
export interface NudgeDismissalRepository {
  /** The viewer's own dismissals in the season, oldest first (`dismissedAt`, ties by target and week). */
  listMine(seasonId: SeasonId, viewerId: MemberId): Promise<readonly NudgeDismissal[]>;
  /**
   * Stores the dismissal. IDEMPOTENT: dismissing a case that is already dismissed succeeds and
   * keeps the first dismissal (the key is `(seasonId, viewerId, targetId, caseWeek)`, an
   * insert-once row: `ON CONFLICT DO NOTHING` on a database), so a double tap is not an error.
   */
  add(dismissal: NudgeDismissal): Promise<void>;
}
