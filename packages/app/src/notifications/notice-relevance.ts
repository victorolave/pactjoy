import { findActiveMember } from "../circle/circle.ts";
import { isPauseStillPending, pausesEndingTomorrow } from "../pause/pause-notices.ts";
import type { Repositories } from "../ports/repositories.ts";
import { isReminderStillDue } from "../reminders/reminder-notices.ts";
import { isReviewDue } from "../review/review-notices.ts";
import type { Instant } from "../time/instant.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import type { OutboxNotice } from "./outbox-notice.ts";

export type Relevance =
  | { readonly kind: "relevant" }
  | { readonly kind: "drop"; readonly outcome: "irrelevant" | "recipientLeft" };

const RELEVANT: Relevance = { kind: "relevant" };
const drop = (outcome: "irrelevant" | "recipientLeft"): Relevance => ({ kind: "drop", outcome });

/**
 * Whether a claimed notice is still worth sending at `now` (REQ-O9, REQ-O11): its recipient must
 * still be the active member it was addressed to, and what it announces must still hold. Pause and
 * review facts are read through their modules' own choke points, never their repositories.
 */
export async function relevanceOf(
  repos: Repositories,
  notice: OutboxNotice,
  now: Instant,
  timeZone: TimeZone,
): Promise<Relevance> {
  const circle = await repos.circles.get(notice.circleId);
  if (
    !circle ||
    findActiveMember(circle, notice.recipientUserId)?.id !== notice.recipientMemberId
  ) {
    return drop("recipientLeft");
  }
  const season = notice.seasonId === null ? null : await repos.seasons.get(notice.seasonId);
  if (!season) return drop("irrelevant");
  const context = { season, circle, now, timeZone };

  let holds: boolean;
  switch (notice.kind) {
    case "pauseRequested":
      holds = await isPauseStillPending(repos, context, notice.params.pauseRequestId);
      break;
    case "pauseApproved":
    case "pauseRejected":
    case "seasonClosed":
      holds = true;
      break;
    case "pauseEndsTomorrow": {
      const { pauseRequestId, lastDate } = notice.params;
      holds = (await pausesEndingTomorrow(repos, context)).some(
        (ending) => ending.record.id === pauseRequestId && ending.lastDate === lastDate,
      );
      break;
    }
    case "pactPendingApproval":
      holds =
        season.status === "pactOpen" &&
        !season.approvals.some((approval) => approval.memberId === notice.recipientMemberId);
      break;
    case "seasonStarted":
      holds = season.status === "active";
      break;
    case "commitmentReminder":
      holds = await isReminderStillDue(repos, context, {
        memberId: notice.recipientMemberId,
        commitmentId: notice.params.commitmentId,
        forDate: notice.params.forDate,
      });
      break;
    case "reviewDue":
      holds = await isReviewDue(
        repos,
        season,
        notice.recipientMemberId,
        notice.params.periodIndex,
        timeZone.localDateAt(now, season.timeZone),
      );
      break;
  }
  return holds ? RELEVANT : drop("irrelevant");
}
