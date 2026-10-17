import { type MemberId, seasonDay } from "@pactjoy/engine";
import type { Circle } from "../circle/circle.ts";
import { enqueueNotices } from "../notifications/enqueue-notices.ts";
import type { NoticeDraft } from "../notifications/outbox-notice.ts";
import type { Repositories } from "../ports/repositories.ts";
import { startWeekdayOf } from "../score/score-input.ts";
import type { Season } from "../season/season.ts";
import type { PauseRequestId } from "../shared/ids.ts";
import { type Instant, instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDateOfSeasonDay, toSeasonDay } from "../time/season-calendar.ts";
import { todayPauseOf } from "../today/today-pause.ts";
import { approversOf, loadEffectiveRequests, type PauseContext } from "./effective-pauses.ts";
import type { PauseRequestRecord } from "./pause-request.ts";
import { toEnginePauses } from "./to-engine.ts";

/**
 * The pause notices (ADR-0017), enqueued at the save sites that change a request's status (agy
 * #5): `requestPause` when the new request stays pending, and every site that persists a
 * pending -> approved/rejected transition (`respondToPause`, `settleSeasonPauses` for the 48 h
 * deadline and the lazy settle-first, `settlePausesOnLeave`). A cancel notifies nobody; a request
 * the requester's own leave cancels notifies nobody either.
 */

const HOUR_MS = 3_600_000;
/** How long the requester's decision notice stays worth sending. */
const DECISION_TTL_MS = 24 * HOUR_MS;

function memberOf(circle: Circle, memberId: MemberId) {
  return circle.members.find((member) => member.id === memberId && member.status === "active");
}

/** An approved request whose last paused day is tomorrow, season-local. */
export interface PauseEndingTomorrow {
  readonly record: PauseRequestRecord;
  readonly lastDate: LocalDate;
}

/**
 * The requests whose pause ends tomorrow (`pauseEndsTomorrow`, agy #12): effectively APPROVED,
 * started, not resumed, and whose last day is tomorrow, either a fixed end or the day an open pause
 * reaches the 50% cap (E15). It is exactly Today's own "ends tomorrow" (`todayPauseOf`), so the push
 * and the screen never disagree. Read through the choke point (`loadEffectiveRequests`).
 */
export async function pausesEndingTomorrow(
  repos: Pick<Repositories, "pauses">,
  context: PauseContext,
): Promise<readonly PauseEndingTomorrow[]> {
  const actualStart = context.season.actualStart;
  if (actualStart === null) return [];
  const today = toSeasonDay(
    context.timeZone.localDateAt(context.now, context.season.timeZone),
    actualStart,
  );
  if (today.kind !== "day") return [];
  const requests = await loadEffectiveRequests(repos, context);
  const engineSeason = {
    lengthWeeks: context.season.lengthWeeks,
    startWeekday: startWeekdayOf(actualStart),
  };
  const found = new Map<string, PauseEndingTomorrow>();
  for (const { record, decision } of requests) {
    if (decision.status !== "approved") continue;
    const own = requests.filter((r) => r.record.memberId === record.memberId);
    const pauses = own.flatMap((r) => toEnginePauses(r.record, r.decision));
    for (const item of record.commitments) {
      const pause = todayPauseOf(item.commitmentId, {
        season: engineSeason,
        today: today.day,
        requests: own,
        history: pauses.filter((p) => p.commitmentId === item.commitmentId),
        dateOf: (day) => localDateOfSeasonDay(seasonDay(day), actualStart),
      });
      if (pause?.pauseRequestId === record.id && pause.endsTomorrow) {
        found.set(record.id, {
          record,
          lastDate: localDateOfSeasonDay(seasonDay(today.day + 1), actualStart),
        });
      }
    }
  }
  return [...found.values()];
}

/** Whether the request is still waiting for answers at `context.now` (a `pauseRequested` is moot otherwise). */
export async function isPauseStillPending(
  repos: Pick<Repositories, "pauses">,
  context: PauseContext,
  id: PauseRequestId,
): Promise<boolean> {
  const requests = await loadEffectiveRequests(repos, context);
  return requests.some(({ record, decision }) => record.id === id && decision.status === "pending");
}

/** `pauseRequested` to every approver of a request that is still pending (none for a solo circle). */
export async function enqueuePauseRequested(
  repos: Pick<Repositories, "notifications">,
  season: Season,
  circle: Circle,
  record: PauseRequestRecord,
  now: Instant,
): Promise<void> {
  if (record.status !== "pending") return;
  const drafts = approversOf(circle, record.memberId).flatMap((approverId): NoticeDraft[] => {
    const approver = memberOf(circle, approverId);
    if (!approver) return [];
    return [
      {
        dedupeKey: `pauseRequested:${record.id}:${approver.id}`,
        kind: "pauseRequested",
        params: { seasonId: season.id, pauseRequestId: record.id },
        circleId: circle.id,
        seasonId: season.id,
        recipientMemberId: approver.id,
        recipientUserId: approver.userId,
        timeZone: season.timeZone,
        notBefore: now,
        // Past the deadline the request is decided anyway: the ask is moot.
        expiresAt: record.autoApproveAt,
        rolloversLeft: 0,
      },
    ];
  });
  await enqueueNotices(repos, drafts, now);
}

/**
 * `pauseApproved` / `pauseRejected` to the requester, when `before` was pending and `after` is
 * approved or rejected. One key per request (`pauseDecided:{id}`): a decision is final, so it is
 * announced at most once whichever write persisted it.
 */
export async function enqueuePauseDecided(
  repos: Pick<Repositories, "notifications">,
  season: Season,
  circle: Circle,
  before: PauseRequestRecord,
  after: PauseRequestRecord,
  now: Instant,
): Promise<void> {
  if (before.status !== "pending") return;
  if (after.status !== "approved" && after.status !== "rejected") return;
  const requester = memberOf(circle, after.memberId);
  if (!requester) return;
  const params = { seasonId: season.id, pauseRequestId: after.id };
  const content =
    after.status === "approved"
      ? ({ kind: "pauseApproved", params } as const)
      : ({ kind: "pauseRejected", params } as const);
  await enqueueNotices(
    repos,
    [
      {
        ...content,
        dedupeKey: `pauseDecided:${after.id}`,
        circleId: circle.id,
        seasonId: season.id,
        recipientMemberId: requester.id,
        recipientUserId: requester.userId,
        timeZone: season.timeZone,
        notBefore: now,
        expiresAt: instant(now + DECISION_TTL_MS),
        rolloversLeft: 0,
      },
    ],
    now,
  );
}
