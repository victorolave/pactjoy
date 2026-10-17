import type { MemberId } from "@pactjoy/engine";
import type { Circle, Member } from "../circle/circle.ts";
import type { FeedWorld } from "../feed/derive-feed.ts";
import type { FeedContext } from "../feed/feed-context.ts";
import { encouragementKey } from "../feed/feed-key.ts";
import type { FeedRecord } from "../feed/feed-record.ts";
import { type FeedSubject, feedSubjectOf } from "../feed/feed-view.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { SeasonId } from "../shared/ids.ts";
import { type NudgeCase, pickNudge } from "./nudge-suggestion.ts";

/**
 * The suggestion as the viewer sees it (ADR-0018, F13, REQ-N7): who, which of their weeks and what
 * it is about. The subject is masked for the viewer like any other (a private commitment is
 * "un objetivo privado"). It carries no count, no percentage and no word about the week
 * itself, so the copy cannot shame.
 */
export interface NudgeSuggestion {
  readonly seasonId: SeasonId;
  readonly targetId: MemberId;
  /** The target's hard week, 1-based: what a send or a dismissal names. */
  readonly week: number;
  readonly subject: FeedSubject;
}

/**
 * The live case for the viewer, or `null`: reads the viewer's OWN sends and dismissals (the only
 * thing the ports allow) and applies `pickNudge`. Reads only.
 */
export async function loadNudgeCase(
  repos: Pick<Repositories, "encouragements" | "nudgeDismissals">,
  context: FeedContext,
  world: FeedWorld,
  viewer: Member,
): Promise<NudgeCase | null> {
  const [sent, dismissed] = await Promise.all([
    repos.encouragements.listSent(context.season.id, viewer.id),
    repos.nudgeDismissals.listMine(context.season.id, viewer.id),
  ]);
  return pickNudge({
    season: context.season,
    actualStart: context.actualStart,
    today: context.today,
    todayDate: context.todayDate,
    circle: context.circle,
    viewerId: viewer.id,
    entries: world.entries,
    requests: world.requests,
    sent,
    dismissed,
  });
}

/** The viewer's suggestion with its subject masked for them. */
export async function loadNudgeSuggestion(
  repos: Pick<Repositories, "encouragements" | "nudgeDismissals">,
  context: FeedContext,
  world: FeedWorld,
  viewer: Member,
): Promise<NudgeSuggestion | null> {
  const picked = await loadNudgeCase(repos, context, world, viewer);
  if (picked === null) return null;
  return {
    seasonId: context.season.id,
    targetId: picked.targetId,
    week: picked.week,
    subject: feedSubjectOf(context.season, world.habits, viewer.id, [picked.commitmentId]),
  };
}

/**
 * The encouragements the viewer RECEIVED as feed records (F14): only theirs, ever. Each says who
 * sent it and with which emoji, and nothing about the case that prompted it.
 */
export async function loadReceivedRecords(
  repos: Pick<Repositories, "encouragements">,
  season: FeedContext["season"],
  circle: Circle,
  viewer: Member,
): Promise<readonly FeedRecord[]> {
  const received = await repos.encouragements.listReceived(season.id, viewer.id);
  return received
    .filter((e) => circle.members.some((m) => m.id === e.senderId))
    .map(
      (e): FeedRecord => ({
        kind: "encouragementReceived",
        key: encouragementKey(e.id),
        onDate: e.sentOn,
        at: e.sentAt,
        senderId: e.senderId,
        emoji: e.emoji,
      }),
    );
}
