import {
  type CommitmentId,
  displayPercent,
  displayPointsDecimal,
  historyProvenance,
  opportunityCounts,
  parseDecimal,
  progressAtValue,
  weekProgress,
} from "@pactjoy/engine";
import type { Measure } from "../commitment/commitment.ts";
import { memberScoreView } from "../score/member-score.query.ts";
import {
  loadScoreContext,
  type ScoreContextError,
  type ScoreQueryDeps,
} from "../score/score-context.ts";
import { toScoreInput } from "../score/score-input.ts";
import type { Actor } from "../shared/actor.ts";
import { toDecimalString } from "../shared/decimal.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { DAYS_PER_WEEK, seasonPhase, weekOf } from "../today/season-phase.ts";
import { dateOfDay } from "../today/today-rows.ts";
import type { CommitmentProgressView } from "./progress-view.ts";

export type CommitmentProgressDeps = ScoreQueryDeps;
export type CommitmentProgressError = ScoreContextError | { readonly kind: "CommitmentNotFound" };
export interface CommitmentProgressInput {
  readonly seasonId: SeasonId;
  readonly commitmentId: CommitmentId;
}

type Started = Extract<CommitmentProgressView, { state: "active" | "ended" }>;

/** Hundredths for sample arithmetic: "12.5" -> 1250n (thresholds carry at most 2 decimals). */
const toCents = (decimal: string) => {
  const [whole = "0", fraction = ""] = decimal.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
};
const fromCents = (cents: bigint) =>
  displayPointsDecimal(
    parseDecimal(`${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`),
  );

/**
 * The values "Cómo puntúa" shows (design 24a: 5 · 10 · 20 · 30 · 60 for minimum 10, ideal 30):
 * below the threshold, the threshold, the middle, the ideal, and past the cap.
 */
function sampleValues(measure: Exclude<Measure, { unit: "done" }>): readonly string[] {
  const { target } = measure;
  const ideal = toCents(toDecimalString(target.ideal));
  const threshold = toCents(
    toDecimalString(target.direction === "reach" ? target.minimum : target.tolerance),
  );
  const middle = (ideal + threshold) / 2n;
  const cents =
    target.direction === "reach"
      ? [threshold / 2n, threshold, middle, ideal, ideal * 2n]
      : [ideal, middle, threshold, threshold * 2n];
  return [...new Set(cents.map(fromCents))];
}

/**
 * One commitment's season (design 24a, 24b) in ONE read and ONE captured instant. Readable by its
 * owner, and by circle members when it is visible; a peer's private commitment fails closed as
 * not found BEFORE any habit read. History cells are the engine's opportunities (E3); evidence
 * is joined only for an authorized commitment and never carries entry or request ids.
 */
export async function commitmentProgress(
  deps: CommitmentProgressDeps,
  actor: Actor,
  input: CommitmentProgressInput,
): Promise<Result<CommitmentProgressView, CommitmentProgressError>> {
  return deps.uow.read(async (repos) => {
    const context = await loadScoreContext(deps, repos, actor, input.seasonId);
    if (!context.ok) return context;
    const { season, circle, viewer, start } = context.value;
    const record = season.commitments.find((c) => c.id === input.commitmentId);
    const owner = circle.members.find((m) => m.id === record?.memberId);
    if (!record || !owner || (owner.id !== viewer.id && record.privacy !== "visible")) {
      return err({ kind: "CommitmentNotFound" });
    }
    if (!start) return ok({ state: "notStarted", seasonId: season.id });
    const today = localDateOfSeasonDay(start.today, start.actualStart);
    const phase = seasonPhase(season, today);
    if (phase.phase === "pactOpen" || phase.phase === "notStarted") {
      return ok({ state: "notStarted", seasonId: season.id });
    }
    const data = {
      entries: await repos.entries.listBySeason(season.id),
      pauses: await repos.pauses.listBySeason(season.id),
    };
    const score = memberScoreView({ ...context.value, start }, data, owner);
    const row =
      score.kind === "scored"
        ? score.commitments.find((c) => c.commitmentId === record.id)
        : undefined;
    if (row?.kind !== "detail")
      throw new Error(`commitment ${record.id} is not readable in detail`);
    const [habit] = await repos.habits.getMany([row.habitId]);
    if (!habit) throw new Error(`habit ${row.habitId} of commitment ${record.id} not found`);

    const scoreInput = toScoreInput({
      season,
      actualStart: start.actualStart,
      memberId: owner.id,
      today: start.today,
      entries: data.entries,
      pauses: data.pauses,
    });
    // The engine's entry indices point into the owner's entries, in the same order.
    const ownerEntries = data.entries.filter((entry) => entry.memberId === owner.id);
    const commitment = scoreInput.commitments.find((c) => c.id === record.id);
    if (!commitment) throw new Error(`commitment ${record.id} missing from the score input`);
    const counts = opportunityCounts(commitment, scoreInput);
    const currentWeek = weekOf(phase.scoringDay) - 1;
    const current = weekProgress({ ...scoreInput, commitment, week: currentWeek });
    const pause =
      current.status !== "scored"
        ? current.status
        : current.excluded.paused.includes(phase.scoringDay)
          ? "paused"
          : current.excluded.onHold.includes(phase.scoringDay)
            ? "onHold"
            : "none";
    const date = (day: number) => dateOfDay(start.actualStart, day);

    const weeks: Started["weeks"] = historyProvenance(commitment, scoreInput).map((history) => {
      const progress = weekProgress({ ...scoreInput, commitment, week: history.week });
      const first = history.week * DAYS_PER_WEEK;
      // Scheduled days arrive in weekday order; a season week can start on any weekday, so show
      // them by date. Reordering only: which opportunity each cell is stays the engine's.
      const cells =
        history.cells[0]?.kind === "day"
          ? [...history.cells].sort((a, b) => (a.day ?? 0) - (b.day ?? 0))
          : history.cells;
      return {
        weekIndex: history.week,
        start: date(first),
        end: date(first + DAYS_PER_WEEK - 1),
        timing:
          history.week < currentWeek ? "past" : history.week === currentWeek ? "current" : "future",
        facts: {
          counted: cells.length > 0 && cells.every((cell) => cell.counted),
          editable: cells.some((cell) => cell.editable),
          final:
            cells.length > 0
              ? cells.every((cell) => cell.final)
              : start.today > first + DAYS_PER_WEEK,
        },
        status: history.status,
        sessionsDone: progress.status === "scored" ? progress.sessionsDone : 0,
        sessionsTarget: progress.status === "scored" ? progress.sessionsTarget : 0,
        cells: cells.map((cell) => ({
          kind: cell.kind,
          date: cell.day === null ? null : date(cell.day),
          status: cell.status,
          progressPercent: cell.progress === null ? null : displayPercent(cell.progress),
          late: cell.late,
          evidence: cell.entryIndices.flatMap((index) => {
            const entry = ownerEntries[index];
            if (!entry) return [];
            const { value } = entry;
            return [
              {
                forDate: date(entry.day),
                recordedOn: date(entry.recordedOn),
                value:
                  value.kind === "quantity"
                    ? { kind: "quantity" as const, value: toDecimalString(value.value) }
                    : { kind: value.kind },
                note: entry.note,
              },
            ];
          }),
        })),
      };
    });

    const { measure } = record;
    const { habitId: _habitId, ...visible } = row;
    return ok({
      state: phase.phase,
      viewerId: viewer.id,
      season: {
        id: season.id,
        timeZone: season.timeZone,
        lengthWeeks: season.lengthWeeks,
        actualStart: start.actualStart,
        lastDay: localDateOfSeasonDay(phase.lastDay, start.actualStart),
      },
      calendar: {
        today,
        weekIndex: currentWeek,
        dayOfWeek: (phase.scoringDay % DAYS_PER_WEEK) + 1,
        daysLeft: phase.lastDay - phase.scoringDay,
      },
      memberId: owner.id,
      commitment: {
        ...visible,
        habit: { name: habit.name, icon: habit.icon },
        opportunities: { kept: counts.kept, counted: counts.counted },
        pause,
      },
      weeks,
      scoring: {
        perOpportunityPoints:
          counts.total === 0 ? null : displayPointsDecimal(counts.perOpportunityPoints),
        opportunityCount: counts.total,
        curve:
          measure.unit === "done"
            ? null
            : sampleValues(measure).map((value) => ({
                value,
                progressPercent: String(
                  displayPercent(progressAtValue(commitment, parseDecimal(value))),
                ),
              })),
      },
    });
  });
}
