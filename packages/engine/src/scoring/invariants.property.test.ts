import { array, assert, constantFrom, integer, property, record, tuple } from "fast-check";
import { describe, expect, it } from "vitest";
import type { Season, Weekday } from "../calendar/season-calendar.ts";
import { seasonDay } from "../calendar/season-calendar.ts";
import type { Commitment, Direction, Frequency, Target } from "../commitment/commitment.ts";
import { fromInt, gte, lte, sum } from "../fraction/fraction.ts";
import type { PauseDecision, PauseEnd } from "../pause/pause.ts";
import { sessionResultsArbitrary, weightPercentPartition } from "../test-support/arbitraries.ts";
import {
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders.ts";
import { scoreCommitmentSoFar } from "./commitment-score.ts";
import type { ScoreInput } from "./member-score.ts";
import { scoreMember } from "./member-score.ts";

const ZERO = fromInt(0);
const TOTAL_POTENTIAL_POINTS = fromInt(1000);

/**
 * F9 (`exact-arithmetic` spec's score-bounds invariant): for any valid
 * commitment/session input, `0 <= commitmentPoints <= weight x 1000` and
 * `0 <= totalPoints <= 1000`. Property-based (fast-check, Q6) rather than a
 * fixed row: it must hold for every generated case, not just one worked
 * example.
 */
describe("scoring invariants (F9, property-based)", () => {
  it("0 <= commitment points <= weightPercent x 10 (weight x 1000), for any session mix", () => {
    assert(
      property(
        integer({ min: 1, max: 20 }).map((steps) => steps * 5),
        sessionResultsArbitrary(),
        (weightPercent, sessions) => {
          const { points } = scoreCommitmentSoFar(weightPercent, sessions, sessions);
          const potential = fromInt(weightPercent * 10);
          expect(gte(points, ZERO)).toBe(true);
          expect(lte(points, potential)).toBe(true);
        },
      ),
    );
  });

  it("0 <= total member points <= 1000, for any 5%-step weight partition and session mix", () => {
    assert(
      property(
        integer({ min: 1, max: 6 }).chain((count) =>
          tuple(
            weightPercentPartition(count),
            array(sessionResultsArbitrary(), { minLength: count, maxLength: count }),
          ),
        ),
        ([weights, sessionsPerCommitment]) => {
          const points = weights.map(
            (weightPercent, i) =>
              scoreCommitmentSoFar(
                weightPercent,
                sessionsPerCommitment[i] ?? [],
                sessionsPerCommitment[i] ?? [],
              ).points,
          );
          const total = sum(points);
          expect(gte(total, ZERO)).toBe(true);
          expect(lte(total, TOTAL_POTENTIAL_POINTS)).toBe(true);
        },
      ),
    );
  });
});

const propertySeason: Season = { lengthWeeks: 4, startWeekday: 0 };
const propertyTotalDays = propertySeason.lengthWeeks * 7;

type ScheduleKind = "timesPerWeek" | "specificDays" | "weeklyTotal";

/** Smaller-first, larger-second (never `Math.min`/`Math.max` -- banned per ADR-0006). */
function sortedPair(a: number, b: number): readonly [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * Arbitrary per-commitment fuzz (SHOULD-FIX, item 3): every schedule kind
 * (`timesPerWeek`, `specificDays`, `weeklyTotal`), both directions (`reach`,
 * `limit`), scattered quantity entries, and 0-2 pause requests whose
 * `decidedOn` can land AFTER `startDay` (exercising the rejection-extension
 * path, `pause-aware-week.ts`'s `rejectionExtendedDeadline`) — any shape,
 * including retroactive-looking or degenerate ones; `pause.ts`'s day-range
 * helpers already tolerate an empty/inverted range without throwing.
 */
function commitmentFuzzArbitrary() {
  return record({
    scheduleKind: constantFrom<ScheduleKind>("timesPerWeek", "specificDays", "weeklyTotal"),
    direction: constantFrom<Direction>("reach", "limit"),
    times: integer({ min: 1, max: 5 }),
    weekdays: array(integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 }),
    thresholdA: integer({ min: 0, max: 20 }),
    thresholdB: integer({ min: 0, max: 20 }),
    entries: array(
      record({
        day: integer({ min: 0, max: propertyTotalDays - 1 }),
        value: integer({ min: 0, max: 30 }),
      }),
      { maxLength: 10 },
    ),
    pauses: array(
      record({
        startDay: integer({ min: 0, max: propertyTotalDays - 1 }),
        decidedOffset: integer({ min: 0, max: 10 }), // decidedOn = startDay + decidedOffset -- can land AFTER startDay
        length: integer({ min: 0, max: propertyTotalDays }),
        endKind: constantFrom<"open" | "fixed">("open", "fixed"),
        decisionKind: constantFrom<"pending" | "approved" | "rejected">(
          "pending",
          "approved",
          "rejected",
        ),
      }),
      { maxLength: 2 },
    ),
  });
}

function targetFor(direction: Direction, thresholdA: number, thresholdB: number): Target {
  const [low, high] = sortedPair(thresholdA, thresholdB);
  if (direction === "reach") {
    // reach requires 0 < minimum <= ideal.
    return {
      direction,
      minimum: fromInt(low === 0 ? 1 : low),
      ideal: fromInt(high === 0 ? 1 : high),
    };
  }
  // limit requires 0 <= ideal <= tolerance.
  return { direction, ideal: fromInt(low), tolerance: fromInt(high) };
}

function frequencyFor(
  scheduleKind: ScheduleKind,
  times: number,
  weekdays: readonly number[],
): Frequency {
  if (scheduleKind === "specificDays") {
    const uniqueWeekdays = [...new Set(weekdays)] as readonly Weekday[];
    return { kind: "specificDays", weekdays: uniqueWeekdays.length > 0 ? uniqueWeekdays : [0] };
  }
  return { kind: "timesPerWeek", times };
}

/**
 * F9's full-pipeline equivalent (requested by the fresh review after slice
 * 6a, task 6b.9; extended per a second fresh-review round, item 3): for
 * EVERY commitment (`0 <= commitmentPoints <= weight x 1000`) AND for the
 * total (`0 <= scoreMember(input).points <= 1000`), across arbitrary
 * commitments (every schedule kind, every direction, via
 * `weightPercentPartition`), arbitrary entries, arbitrary pauses (any shape,
 * including retroactive-looking/degenerate ones, and rejections whose
 * `decidedOn` lands after `startDay` -- `scoreMember` never throws on those,
 * it just scores whatever `pauseAwareWeekSessions` resolves) and an
 * arbitrary `today` anywhere from the season's start through a few days
 * past its end. This exercises the WHOLE composition -- R1's so-far gating,
 * D9's pause cap, D12's mid-season redistribution, R7's counted-so-far
 * consistency/idealCompletion, and D11's streak -- catching a regression
 * that slice 6a's per-commitment-only property test (F9, above) cannot see.
 */
describe("scoring invariants (F9 full pipeline, property-based, slice 6b)", () => {
  it("0 <= points <= potential for every commitment, and 0 <= total <= 1000, for arbitrary commitments/entries/pauses/today", () => {
    assert(
      property(
        integer({ min: 1, max: 5 }).chain((count) =>
          tuple(
            weightPercentPartition(count),
            array(commitmentFuzzArbitrary(), { minLength: count, maxLength: count }),
            integer({ min: 0, max: propertyTotalDays + 5 }),
          ),
        ),
        ([weights, fuzzes, today]) => {
          const commitments = weights.map((weightPercent, i): Commitment => {
            const fuzz = fuzzes[i];
            const scheduleKind: ScheduleKind = fuzz?.scheduleKind ?? "timesPerWeek";
            const direction: Direction = fuzz?.direction ?? "reach";
            const target = targetFor(direction, fuzz?.thresholdA ?? 1, fuzz?.thresholdB ?? 1);
            const id = `c${i}`;
            if (scheduleKind === "weeklyTotal") {
              return buildWeeklyTotalCommitment(id, weightPercent, "minutes", target);
            }
            const frequency = frequencyFor(scheduleKind, fuzz?.times ?? 1, fuzz?.weekdays ?? [0]);
            return buildQuantityCommitment(id, weightPercent, "minutes", target, frequency);
          });
          const entries = weights.flatMap((_, i) =>
            (fuzzes[i]?.entries ?? []).map((e) =>
              buildQuantityEntry(`c${i}`, e.day, fromInt(e.value)),
            ),
          );
          const pauses = weights.flatMap((_, i) =>
            (fuzzes[i]?.pauses ?? []).map((p) => {
              const uncappedLastDay = p.startDay + p.length;
              const lastDay = seasonDay(
                uncappedLastDay < propertyTotalDays ? uncappedLastDay : propertyTotalDays - 1,
              );
              const end: PauseEnd =
                p.endKind === "open" ? { kind: "open" } : { kind: "fixed", lastDay };
              // decidedOn = startDay + decidedOffset -- lands AFTER startDay whenever offset > 0,
              // exercising rejectionExtendedDeadline's overlap check for approved/rejected alike.
              const decidedOn = seasonDay(p.startDay + p.decidedOffset);
              const decision: PauseDecision =
                p.decisionKind === "pending"
                  ? { kind: "pending" }
                  : p.decisionKind === "approved"
                    ? { kind: "approved", decidedOn, resumedOn: null }
                    : { kind: "rejected", decidedOn };
              return buildPauseRequest(`c${i}`, p.startDay, end, decision);
            }),
          );
          const input: ScoreInput = {
            season: propertySeason,
            commitments,
            entries,
            pauses,
            today: seasonDay(today),
          };
          const score = scoreMember(input);
          for (let i = 0; i < score.commitments.length; i++) {
            const commitmentScore = score.commitments[i];
            const weightPercent = weights[i];
            if (commitmentScore === undefined || weightPercent === undefined) continue;
            const potential = fromInt(weightPercent * 10);
            expect(gte(commitmentScore.points, ZERO)).toBe(true);
            expect(lte(commitmentScore.points, potential)).toBe(true);
          }
          expect(gte(score.points, ZERO)).toBe(true);
          expect(lte(score.points, TOTAL_POTENTIAL_POINTS)).toBe(true);
        },
      ),
    );
  });
});
