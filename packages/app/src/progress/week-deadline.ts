import type { MemberId, SeasonDay, Weekday } from "@pactjoy/engine";
import { entryGraceDeadline, graceDeadline, seasonDay } from "@pactjoy/engine";
import type { MemberPauseRequest } from "../pause/pause-request.repository.ts";
import { startWeekdayOf } from "../score/score-input.ts";
import type { Season } from "../season/season.ts";
import type { LocalDate } from "../time/local-date.ts";
import { DAYS_PER_WEEK } from "../today/season-phase.ts";

export interface WeekDeadlineInput {
  readonly season: Season;
  readonly actualStart: LocalDate;
  readonly weekIndex: number;
  /** The effective Pauses (the choke point's output), never the stored ones. */
  readonly pauses: readonly MemberPauseRequest[];
  /** Only this member's Commitments count; omitted means the whole circle. */
  readonly memberId?: MemberId;
}

/**
 * The last day any Entry of the week is still accepted (EW-3): the latest
 * `entryGraceDeadline` over the Commitments' opportunities in the week, so a
 * rejected or cancelled request that extends the window keeps the week from
 * reading final (and non-editable) while an Entry is still accepted and scored.
 * A week without any Commitment falls back to the plain grace deadline.
 */
export function weekDeadline({
  season,
  actualStart,
  weekIndex,
  pauses,
  memberId,
}: WeekDeadlineInput): SeasonDay {
  const firstDay = weekIndex * DAYS_PER_WEEK;
  const lastDay = seasonDay(firstDay + DAYS_PER_WEEK - 1);
  const startWeekday = startWeekdayOf(actualStart);
  let deadline: SeasonDay = graceDeadline(lastDay);
  for (const commitment of season.commitments) {
    if (memberId !== undefined && commitment.memberId !== memberId) continue;
    const { schedule } = commitment.measure;
    const commitmentPauses = pauses.filter((pause) => pause.commitmentId === commitment.id);
    for (let offset = 0; offset < DAYS_PER_WEEK; offset++) {
      const day = seasonDay(firstDay + offset);
      if (
        schedule.period === "perSession" &&
        schedule.frequency.kind === "specificDays" &&
        !schedule.frequency.weekdays.includes(((startWeekday + day) % DAYS_PER_WEEK) as Weekday)
      ) {
        continue;
      }
      const candidate = entryGraceDeadline(schedule, day, commitmentPauses);
      if (candidate > deadline) deadline = candidate;
    }
  }
  return deadline;
}
