import type { Repositories } from "../ports/repositories.ts";
import type { Instant } from "../time/instant.ts";
import { MAX_DEDUPE_KEY_LENGTH, type NoticeDraft, type OutboxNotice } from "./outbox-notice.ts";

/**
 * THE way any module adds notices (ADR-0017, `notification-guard.test.ts`): plain rows in the
 * caller's own transaction, so they commit or roll back with the change they announce, and no
 * network call ever happens inside `work` (ADR-0010). A dedupe key already stored is skipped, so
 * a re-run of the same write (or of a job) adds nothing.
 * @returns how many notices were new.
 */
export async function enqueueNotices(
  repos: Pick<Repositories, "notifications">,
  drafts: readonly NoticeDraft[],
  now: Instant,
): Promise<number> {
  if (drafts.length === 0) return 0;
  for (const draft of drafts) {
    if (draft.dedupeKey.length === 0 || draft.dedupeKey.length > MAX_DEDUPE_KEY_LENGTH) {
      throw new RangeError(`enqueueNotices: dedupe key length ${draft.dedupeKey.length}`);
    }
  }
  const rows = drafts.map(
    (draft): OutboxNotice => ({
      ...draft,
      state: "pending",
      attempts: 0,
      leaseUntil: null,
      outcome: null,
      createdAt: now,
      finishedAt: null,
    }),
  );
  return repos.notifications.enqueue(rows);
}
