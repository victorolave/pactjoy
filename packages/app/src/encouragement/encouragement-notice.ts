import type { MemberId } from "@pactjoy/engine";
import { activeMembers, type Circle } from "../circle/circle.ts";
import { enqueueNotices } from "../notifications/enqueue-notices.ts";
import type { NoticeDraft } from "../notifications/outbox-notice.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { ReactionEmoji } from "../reaction/feed-reaction.ts";
import type { Season } from "../season/season.ts";
import type { EncouragementId, SeasonId, UserId } from "../shared/ids.ts";
import { type Instant, instant } from "../time/instant.ts";
import type { Encouragement } from "./encouragement.ts";

/**
 * What the push for an encouragement needs, resolved at dispatch (ADR-0018, F17). It deliberately
 * carries nothing about the case behind it (the week, the habit, the consistency): the recipient
 * is told who sent what, and no more.
 */
export interface EncouragementNotice {
  readonly encouragementId: EncouragementId;
  readonly seasonId: SeasonId;
  readonly recipient: { readonly memberId: MemberId; readonly userId: UserId };
  readonly sender: { readonly memberId: MemberId; readonly displayName: string };
  readonly emoji: ReactionEmoji;
}

/** How long the push stays worth sending: past a day the feed item says it better. */
const NOTICE_TTL_MS = 86_400_000;

/**
 * Enqueues the `encouragementNudge` push to the recipient (ADR-0018 F17, ADR-0017), inside
 * `sendEncouragement`'s transaction so it commits or rolls back with the encouragement. One per
 * encouragement (`encouragement:<id>`), ids only: nothing about the week, the habit, the
 * consistency, the sender or the emoji enters the outbox. Quiet hours apply at dispatch.
 */
export async function enqueueEncouragementNudge(
  repos: Pick<Repositories, "notifications">,
  encouragement: Encouragement,
  season: Season,
  circle: Circle,
  now: Instant,
): Promise<void> {
  const recipient = activeMembers(circle).find((m) => m.id === encouragement.recipientId);
  if (!recipient) return;
  const draft: NoticeDraft = {
    dedupeKey: `encouragement:${encouragement.id}`,
    kind: "encouragementNudge",
    params: { seasonId: season.id, encouragementId: encouragement.id },
    circleId: circle.id,
    seasonId: season.id,
    recipientMemberId: recipient.id,
    recipientUserId: recipient.userId,
    timeZone: season.timeZone,
    notBefore: now,
    expiresAt: instant(now + NOTICE_TTL_MS),
    rolloversLeft: 0,
  };
  await enqueueNotices(repos, [draft], now);
}

/**
 * What the dispatcher checks before sending an `encouragementNudge` (`relevanceOf`, ADR-0018 F17):
 * it resolves the encouragement at send time.
 *
 * `null` when there is nothing to tell anyone: the encouragement is gone, or its recipient or
 * sender is no longer in the circle (no push to someone who left, and none from a sender who did).
 * Reads only, and only the one row it was handed the id of.
 */
export async function encouragementNotice(
  repos: Pick<Repositories, "encouragements" | "seasons" | "circles">,
  id: EncouragementId,
): Promise<EncouragementNotice | null> {
  const encouragement = await repos.encouragements.get(id);
  if (encouragement === null) return null;
  const season = await repos.seasons.get(encouragement.seasonId);
  const circle = season ? await repos.circles.get(season.circleId) : null;
  const recipient = circle?.members.find((m) => m.id === encouragement.recipientId);
  const sender = circle?.members.find((m) => m.id === encouragement.senderId);
  if (recipient?.status !== "active" || sender?.status !== "active") return null;
  return {
    encouragementId: encouragement.id,
    seasonId: encouragement.seasonId,
    recipient: { memberId: recipient.id, userId: recipient.userId },
    sender: { memberId: sender.id, displayName: sender.displayName },
    emoji: encouragement.emoji,
  };
}
