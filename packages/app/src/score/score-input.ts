import type { Entry, MemberId, ScoreInput, SeasonDay, Weekday } from "@pactjoy/engine";
import { commitmentToEngine } from "../commitment/to-engine.ts";
import type { EntryRecord } from "../entry/entry.ts";
import type { MemberPauseRequest } from "../pause/pause-request.repository.ts";
import type { Season } from "../season/season.ts";
import { epochDay, type LocalDate } from "../time/local-date.ts";

const DAYS_PER_WEEK = 7;
/** 1970-01-01 (epoch day 0) was a Thursday, which is weekday 3 with Monday = 0. */
const EPOCH_WEEKDAY = 3;

/** The engine's {@link Weekday} (Monday = 0) of a civil date, in pure integer math (D8). */
export function startWeekdayOf(date: LocalDate): Weekday {
  // `localDate` floors at the epoch, so epoch days are never negative.
  return ((epochDay(date) + EPOCH_WEEKDAY) % DAYS_PER_WEEK) as Weekday;
}

/** One stored entry as the engine reads it (1:1; no gap is ever filled). */
export function toEngineEntry(record: EntryRecord): Entry {
  const base = {
    commitmentId: record.commitmentId,
    day: record.day,
    recordedOn: record.recordedOn,
  };
  return record.value.kind === "quantity"
    ? { ...base, kind: "quantity", value: record.value.value }
    : { ...base, kind: record.value.kind };
}

export interface ToScoreInputArgs {
  readonly season: Season;
  /** The season's resolved start date; scoring only exists once the season has one. */
  readonly actualStart: LocalDate;
  readonly memberId: MemberId;
  readonly entries: readonly EntryRecord[];
  readonly pauses: readonly MemberPauseRequest[];
  readonly today: SeasonDay;
}

/**
 * Maps stored aggregates to the engine's {@link ScoreInput} for ONE member
 * (design, Engine mapping). Entries map 1:1 and the mapper NEVER fills gaps:
 * no synthetic `missed`, no synthetic 0 for `limit` -- absence reaches the
 * engine as absence (A8). Only the member's own commitments, entries and
 * pauses are included.
 */
export function toScoreInput(args: ToScoreInputArgs): ScoreInput {
  const commitments = args.season.commitments.filter(
    (commitment) => commitment.memberId === args.memberId,
  );
  return {
    season: {
      lengthWeeks: args.season.lengthWeeks,
      startWeekday: startWeekdayOf(args.actualStart),
    },
    commitments: commitments.map(commitmentToEngine),
    entries: args.entries.filter((entry) => entry.memberId === args.memberId).map(toEngineEntry),
    pauses: args.pauses
      .filter((pause) => pause.memberId === args.memberId)
      .map(({ memberId: _memberId, ...pause }) => pause),
    today: args.today,
  };
}
