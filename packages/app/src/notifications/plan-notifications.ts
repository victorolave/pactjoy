import type { Circle } from "../circle/circle.ts";
import { pausesEndingTomorrow } from "../pause/pause-notices.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { interimReviewDueFrom, isReviewDue } from "../review/review-notices.ts";
import { participantsOf } from "../season/closure/finalize.ts";
import { closeDatesOf } from "../season/closure/season-calendar.ts";
import type { Season } from "../season/season.ts";
import { ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { Instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { type TimeZone, timeZoneId } from "../time/time-zone.port.ts";
import { enqueueNotices } from "./enqueue-notices.ts";
import { addDays, inPlanningWindow, morningWindow } from "./notice-timing.ts";
import { KIND_POLICY, type NoticeContent } from "./notification-kind.ts";
import type { NoticeDraft } from "./outbox-notice.ts";

export interface PlanNotificationsDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

/** The job runs as the system: there is no actor. */
export type PlanNotificationsInput = Record<string, never>;

export interface PlanNotificationsResult {
  /** How many notices this run added; `0` on a repeat. */
  readonly enqueued: number;
}

/**
 * How far back a closed season can still have a notice due: 12 weeks, the grace and results days,
 * and one rollover day, with margin.
 */
const LOOKBACK_DAYS = 90;
const UTC = timeZoneId("UTC");

/** The calendar notices of one season due on `date`, to its participants. */
async function calendarNotices(
  repos: Repositories,
  season: Season,
  circle: Circle,
  date: LocalDate,
  today: LocalDate,
): Promise<
  readonly {
    readonly content: NoticeContent;
    readonly memberId: string;
    readonly subject: string;
  }[]
> {
  const participants = participantsOf(season, circle);
  const out: { content: NoticeContent; memberId: string; subject: string }[] = [];
  const toAll = (content: NoticeContent, subject: string) => {
    for (const memberId of participants) out.push({ content, memberId, subject });
  };
  if (season.status === "active" && season.actualStart === date) {
    toAll({ kind: "seasonStarted", params: { seasonId: season.id } }, "");
  }
  if (closeDatesOf(season)?.resultsOn === date) {
    toAll({ kind: "seasonClosed", params: { seasonId: season.id } }, "");
  }
  const period = season.status === "active" ? interimReviewDueFrom(season, date) : null;
  if (period !== null) {
    for (const memberId of participants) {
      // The member's own review, read inside the review module; a review already answered is skipped.
      if (!(await isReviewDue(repos, season, memberId, period, today))) continue;
      out.push({
        content: { kind: "reviewDue", params: { seasonId: season.id, periodIndex: period } },
        memberId,
        subject: `${period}`,
      });
    }
  }
  return out;
}

/** Every notice the planner owes for one season at `now` (inside its 09:00-22:00 window). */
async function seasonDrafts(
  repos: Repositories,
  season: Season,
  circle: Circle,
  now: Instant,
  timeZone: TimeZone,
): Promise<readonly NoticeDraft[]> {
  const today = timeZone.localTimeAt(now, season.timeZone).date;
  const window = morningWindow(today, season.timeZone, timeZone);
  const drafts: NoticeDraft[] = [];
  const add = (content: NoticeContent, memberId: string, subject: string, rolloversLeft: 0 | 1) => {
    const member = circle.members.find((m) => m.id === memberId && m.status === "active");
    if (!member) return;
    const key = [content.kind, season.id, ...(subject === "" ? [] : [subject]), member.id];
    drafts.push({
      ...content,
      dedupeKey: key.join(":"),
      circleId: circle.id,
      seasonId: season.id,
      recipientMemberId: member.id,
      recipientUserId: member.userId,
      timeZone: season.timeZone,
      ...window,
      rolloversLeft,
    });
  };

  // Today's notices keep their rollover; yesterday's (a day the planner never ran) get today's
  // window once, and only for kinds that roll over.
  for (const notice of await calendarNotices(repos, season, circle, today, today)) {
    add(
      notice.content,
      notice.memberId,
      notice.subject,
      KIND_POLICY[notice.content.kind].rollover ? 1 : 0,
    );
  }
  for (const notice of await calendarNotices(repos, season, circle, addDays(today, -1), today)) {
    if (KIND_POLICY[notice.content.kind].rollover)
      add(notice.content, notice.memberId, notice.subject, 0);
  }

  if (season.status === "active") {
    for (const { record, lastDate } of await pausesEndingTomorrow(repos, {
      season,
      circle,
      now,
      timeZone,
    })) {
      add(
        {
          kind: "pauseEndsTomorrow",
          params: { seasonId: season.id, pauseRequestId: record.id, lastDate },
        },
        record.memberId,
        `${record.id}:${lastDate}`,
        0,
      );
    }
  }
  return drafts;
}

/**
 * Plans the calendar notices (ADR-0017, design J6): `seasonStarted` on the start day, `reviewDue` on
 * the first day of each interim review, `seasonClosed` on the results day (absorbing the closing
 * review) and `pauseEndsTomorrow` the day before a pause's last day, each to the participants,
 * 09:00 to 22:00 season-local. It plans only while `now` is inside that window, so nothing is ever
 * planned for a day already over. It keeps no state: the dedupe key is the memory, so a re-run, a
 * concurrent run or a late run adds nothing twice (REQ-O4). One transaction per season.
 */
export async function planNotifications(
  deps: PlanNotificationsDeps,
  _input: PlanNotificationsInput,
): Promise<Result<PlanNotificationsResult, never>> {
  const now = deps.clock.now();
  const since = addDays(deps.timeZone.localDateAt(now, UTC), -LOOKBACK_DAYS);
  const listed = await deps.uow.read((repos) => repos.seasons.listForPlanning(since));

  let enqueued = 0;
  for (const candidate of listed) {
    if (!inPlanningWindow(now, candidate.timeZone, deps.timeZone)) continue;
    const result = await deps.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(candidate.id);
      const circle = season ? await repos.circles.get(season.circleId) : null;
      if (!season || !circle || season.actualStart === null) return ok(0);
      return ok(
        await enqueueNotices(
          repos,
          await seasonDrafts(repos, season, circle, now, deps.timeZone),
          now,
        ),
      );
    });
    if (result.ok) enqueued += result.value;
  }
  return ok({ enqueued });
}
