import { activeMembers, type Circle } from "../circle/circle.ts";
import { enqueueNotices } from "../notifications/enqueue-notices.ts";
import type { NoticeDraft } from "../notifications/outbox-notice.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import { type Instant, instant } from "../time/instant.ts";
import type { TimeZone } from "../time/time-zone.port.ts";

const DAY_MS = 86_400_000;

/**
 * `pactPendingApproval` (ADR-0017, design J5): after an approval that leaves the pact open, every
 * active member without an approval hears that the pact waits for them. There is no "propose"
 * step; an edit resets the approvals and the editor's own re-approval is what asks the others, so
 * a burst of edits does not spam. The key carries the season-local day: one push per recipient,
 * season and day (owner decision), whatever the revision.
 */
export async function enqueuePactPending(
  repos: Pick<Repositories, "notifications">,
  season: Season,
  circle: Circle,
  now: Instant,
  timeZone: TimeZone,
): Promise<void> {
  if (season.status !== "pactOpen") return;
  const today = timeZone.localDateAt(now, season.timeZone);
  const drafts = activeMembers(circle)
    .filter((member) => !season.approvals.some((approval) => approval.memberId === member.id))
    .map(
      (member): NoticeDraft => ({
        dedupeKey: `pactPending:${season.id}:${member.id}:${today}`,
        kind: "pactPendingApproval",
        params: { seasonId: season.id, pactRevision: season.pactRevision },
        circleId: circle.id,
        seasonId: season.id,
        recipientMemberId: member.id,
        recipientUserId: member.userId,
        timeZone: season.timeZone,
        notBefore: now,
        expiresAt: instant(now + DAY_MS),
        rolloversLeft: 0,
      }),
    );
  await enqueueNotices(repos, drafts, now);
}
