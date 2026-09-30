import type { MemberId } from "@pactjoy/engine";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import type { EntryRecord } from "../entry/entry.ts";

/**
 * The single place the commitment privacy rule lives (Notion "Privada" /
 * "Visible", A11). A commitment's detail is visible to its owner always and
 * to every other member only when the commitment is `visible`.
 */
export function canSeeDetail(commitment: CommitmentRecord, viewer: MemberId): boolean {
  return commitment.privacy === "visible" || commitment.memberId === viewer;
}

/**
 * The evidence (note) of an entry as `viewer` may see it (ER-14, ER-15):
 * evidence follows the privacy of the entry's commitment, so a private
 * commitment's note is never shown to other members. Returns `null` when
 * there is no note or it must not be shown; the two are indistinguishable
 * on purpose.
 */
export function visibleNote(
  entry: EntryRecord,
  commitment: CommitmentRecord,
  viewer: MemberId,
): string | null {
  if (entry.commitmentId !== commitment.id) {
    throw new Error(`entry ${entry.id} does not belong to commitment ${commitment.id}`);
  }
  return canSeeDetail(commitment, viewer) ? entry.note : null;
}
