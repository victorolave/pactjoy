import type { CommitmentId, MemberId } from "@pactjoy/engine";
import { type Circle, findActiveMember } from "../circle/circle.ts";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import { loadEffectiveRequests } from "../pause/effective-pauses.ts";
import { toEnginePauses } from "../pause/to-engine.ts";
import type { Repositories } from "../ports/repositories.ts";
import { startWeekdayOf } from "../score/score-input.ts";
import type { Season } from "../season/season.ts";
import type { UserId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { type TodayRow, todayRows } from "../today/today-rows.ts";
import { type CommitmentReminder, REMINDER_VALIDITY_MINUTES } from "./commitment-reminder.ts";

/** One season, observed at one instant. */
export interface ReminderContext {
  readonly season: Season;
  readonly circle: Circle;
  readonly now: Instant;
  readonly timeZone: TimeZone;
}

/** A reminder the planner owes now: to its owner, about today, valid within its hour. */
export interface DueReminder {
  readonly memberId: MemberId;
  readonly userId: UserId;
  readonly commitmentId: CommitmentId;
  readonly forDate: LocalDate;
  readonly notBefore: Instant;
  readonly expiresAt: Instant;
}

/** 22:00: no reminder is valid into the quiet hours. */
const QUIET_START_MINUTE = 22 * 60;

/**
 * Whether today is still open to register for each of a member's commitments, by the SAME
 * `todayRows` the Today screen uses (design J18), so "done" means what the owner sees. A row is
 * open when its opportunity is `open` (not logged today, paused, on hold or closed) and, for a day
 * row, it has a session today; a week row also needs its week not yet complete: `timesPerWeek`
 * short of its (prorated) sessions, a `weeklyTotal` reach short of its ideal.
 */
async function openToday(
  repos: Repositories,
  context: ReminderContext,
  memberId: MemberId,
  commitments: readonly CommitmentRecord[],
  date: LocalDate,
): Promise<ReadonlySet<CommitmentId>> {
  const { season, circle, now, timeZone } = context;
  const actualStart = season.actualStart;
  if (season.status !== "active" || actualStart === null || commitments.length === 0) {
    return new Set();
  }
  const day = toSeasonDay(date, actualStart);
  if (day.kind !== "day" || day.day >= season.lengthWeeks * 7) return new Set();

  const habits = await repos.habits.getMany(commitments.map((c) => c.habitId));
  const live = commitments.filter((c) => {
    const habit = habits.find((h) => h.id === c.habitId);
    return habit !== undefined && habit.graduatedAt === null;
  });
  if (live.length === 0) return new Set();

  const requests = await loadEffectiveRequests(repos, { season, circle, now, timeZone });
  const pauses = requests.flatMap(({ record, decision }) => toEnginePauses(record, decision));
  const entries = await repos.entries.listBySeason(season.id);
  const { rows } = todayRows({
    season,
    actualStart,
    commitments: live,
    habits,
    entries: entries.filter((entry) => entry.memberId === memberId),
    pauses: pauses.filter((pause) => pause.memberId === memberId),
    pauseRequests: requests.filter(({ record }) => record.memberId === memberId),
    today: day.day,
    refDay: day.day,
  });
  const open = new Set<CommitmentId>();
  for (const row of rows) {
    const commitment = live.find((c) => c.id === row.commitmentId);
    if (commitment && isOpen(row, commitment)) open.add(row.commitmentId);
  }
  return open;
}

function isOpen(row: TodayRow, commitment: CommitmentRecord): boolean {
  if (row.opportunity.state !== "open") return false;
  if (row.kind === "day") return row.scheduledToday;
  const progress = row.progress;
  if (progress === null) return false;
  const { measure } = commitment;
  if (measure.schedule.period === "perSession") {
    return progress.sessionsDone < progress.sessionsTarget;
  }
  // weeklyTotal: a reach is complete at its ideal; a limit is never "done" early.
  return measure.unit === "done" || measure.target.direction !== "reach" || progress.percent < 100;
}

/**
 * The reminders of `context.season` due at `now` (REQ-R5..R7, design J18): enabled, on today's
 * weekday, with `now` inside [time, min(time + 1 h, 22:00)), owned by a member who is still active,
 * and about a day still open for that commitment. One per commitment and day: the planner's dedupe
 * key holds it there. Reminders are user-timed inside 08:00-21:45, so quiet hours never shift them.
 */
export async function dueReminders(
  repos: Repositories,
  context: ReminderContext,
): Promise<readonly DueReminder[]> {
  const { season, circle, now, timeZone } = context;
  if (season.status !== "active") return [];
  const local = timeZone.localTimeAt(now, season.timeZone);
  const weekday = startWeekdayOf(local.date);
  const windowEnd = (reminder: CommitmentReminder) => {
    const end = reminder.minuteOfDay + REMINDER_VALIDITY_MINUTES;
    return end < QUIET_START_MINUTE ? end : QUIET_START_MINUTE;
  };
  const candidates = (await repos.reminders.listEnabled(season.id)).filter(
    (reminder) =>
      reminder.weekdays.includes(weekday) &&
      local.minuteOfDay >= reminder.minuteOfDay &&
      local.minuteOfDay < windowEnd(reminder),
  );

  const out: DueReminder[] = [];
  const byMember = new Map<MemberId, CommitmentReminder[]>();
  for (const reminder of candidates) {
    byMember.set(reminder.memberId, [...(byMember.get(reminder.memberId) ?? []), reminder]);
  }
  for (const [memberId, reminders] of byMember) {
    const member = circle.members.find((m) => m.id === memberId && m.status === "active");
    if (!member) continue;
    const owned = season.commitments.filter(
      (c) => c.memberId === memberId && reminders.some((r) => r.commitmentId === c.id),
    );
    const open = await openToday(repos, context, memberId, owned, local.date);
    for (const reminder of reminders) {
      if (!open.has(reminder.commitmentId)) continue;
      out.push({
        memberId,
        userId: member.userId,
        commitmentId: reminder.commitmentId,
        forDate: local.date,
        notBefore: timeZone.instantAt(local.date, reminder.minuteOfDay, season.timeZone),
        expiresAt: timeZone.instantAt(local.date, windowEnd(reminder), season.timeZone),
      });
    }
  }
  return out;
}

/**
 * Whether a planned reminder still holds at dispatch (REQ-R6, REQ-R8, SC-R10): still about today,
 * still enabled on that weekday, its owner still the active member it was planned for, and the day
 * still open (nothing registered since, no pause, the week not complete).
 */
export async function isReminderStillDue(
  repos: Repositories,
  context: ReminderContext,
  planned: {
    readonly memberId: MemberId;
    readonly commitmentId: CommitmentId;
    readonly forDate: LocalDate;
  },
): Promise<boolean> {
  const { season, circle, now, timeZone } = context;
  if (timeZone.localTimeAt(now, season.timeZone).date !== planned.forDate) return false;
  const reminder = await repos.reminders.get(season.id, planned.commitmentId);
  if (
    !reminder?.enabled ||
    reminder.memberId !== planned.memberId ||
    !reminder.weekdays.includes(startWeekdayOf(planned.forDate))
  ) {
    return false;
  }
  const member = circle.members.find((m) => m.id === planned.memberId && m.status === "active");
  if (!member || findActiveMember(circle, member.userId)?.id !== member.id) return false;
  const commitment = season.commitments.find(
    (c) => c.id === planned.commitmentId && c.memberId === planned.memberId,
  );
  if (!commitment) return false;
  const open = await openToday(repos, context, planned.memberId, [commitment], planned.forDate);
  return open.has(commitment.id);
}
