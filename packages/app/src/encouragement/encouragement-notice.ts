import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../ports/repositories.ts";
import type { ReactionEmoji } from "../reaction/feed-reaction.ts";
import type { EncouragementId, SeasonId, UserId } from "../shared/ids.ts";

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

/**
 * The hook for job D (ADR-0018, F17; coordination contract of 2026-10-17). Whichever of this change and D1
 * lands second wires the `encouragementNudge` notification: it enqueues
 * `{kind: "encouragementNudge", recipient, params: {encouragementId}, dedupeKey: "encouragement:<id>"}`
 * inside `sendEncouragement`'s transaction, and the dispatcher calls this with the id to resolve
 * the names at send time. Nothing here enqueues, because D owns the outbox and the notification port.
 *
 * `null` when there is nothing to tell anyone: the encouragement is gone, or its recipient or
 * sender is no longer in the circle (no push to someone who left, and no name for a sender who did).
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
