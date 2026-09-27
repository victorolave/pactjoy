/**
 * Fixture builders for tests only — never exported from `index.ts`.
 *
 * `Entry` builders were added in slice 3 (opportunity generation, the first
 * slice that needs them). `Season` builders are still deferred to whichever
 * slice first needs one.
 */
import type { SeasonDay } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import type {
  CommitmentId,
  DoneCommitment,
  Frequency,
  QuantityCommitment,
  QuantityUnit,
  Target,
} from "../commitment/commitment";
import type { Entry } from "../entry/entry";
import type { Fraction } from "../fraction/fraction";
import type { PauseDecision, PauseEnd, PauseRequest } from "../pause/pause";

const DEFAULT_FREQUENCY: Frequency = { kind: "timesPerWeek", times: 3 };

export function buildDoneCommitment(
  id: string,
  weightPercent: number,
  frequency: Frequency = DEFAULT_FREQUENCY,
): DoneCommitment {
  return {
    id: id as DoneCommitment["id"],
    weightPercent,
    unit: "done",
    schedule: { period: "perSession", frequency },
  };
}

export function buildQuantityCommitment(
  id: string,
  weightPercent: number,
  unit: QuantityUnit,
  target: Target,
  frequency: Frequency = DEFAULT_FREQUENCY,
): QuantityCommitment {
  return {
    id: id as QuantityCommitment["id"],
    weightPercent,
    unit,
    target,
    schedule: { period: "perSession", frequency },
  };
}

export function buildWeeklyTotalCommitment(
  id: string,
  weightPercent: number,
  unit: QuantityUnit,
  target: Target,
): QuantityCommitment {
  return {
    id: id as QuantityCommitment["id"],
    weightPercent,
    unit,
    target,
    schedule: { period: "weeklyTotal" },
  };
}

function toSeasonDay(day: SeasonDay | number): SeasonDay {
  return typeof day === "number" ? seasonDay(day) : day;
}

export function buildQuantityEntry(
  commitmentId: string,
  day: SeasonDay | number,
  value: Fraction,
  recordedOn: SeasonDay | number = day,
): Entry {
  return {
    commitmentId: commitmentId as CommitmentId,
    day: toSeasonDay(day),
    recordedOn: toSeasonDay(recordedOn),
    kind: "quantity",
    value,
  };
}

export function buildPauseRequest(
  commitmentId: string,
  startDay: SeasonDay | number,
  end: PauseEnd,
  decision: PauseDecision,
  requestedOn: SeasonDay | number = startDay,
): PauseRequest {
  return {
    commitmentId: commitmentId as CommitmentId,
    requestedOn: toSeasonDay(requestedOn),
    startDay: toSeasonDay(startDay),
    end,
    decision,
  };
}

export function buildDoneEntry(
  commitmentId: string,
  day: SeasonDay | number,
  recordedOn: SeasonDay | number = day,
): Entry {
  return {
    commitmentId: commitmentId as CommitmentId,
    day: toSeasonDay(day),
    recordedOn: toSeasonDay(recordedOn),
    kind: "done",
  };
}

/** The explicit "Hoy no salio" entry — like an absent entry it counts as zero progress, but (unlike an absent entry) it satisfies R1's "so far" counting rule via `value !== null` before the grace deadline passes. */
export function buildMissedEntry(
  commitmentId: string,
  day: SeasonDay | number,
  recordedOn: SeasonDay | number = day,
): Entry {
  return {
    commitmentId: commitmentId as CommitmentId,
    day: toSeasonDay(day),
    recordedOn: toSeasonDay(recordedOn),
    kind: "missed",
  };
}
