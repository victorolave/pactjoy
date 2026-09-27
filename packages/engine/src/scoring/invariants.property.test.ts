import { array, assert, constantFrom, integer, property, record, tuple } from "fast-check";
import { describe, expect, it } from "vitest";
import type { Season } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import { fromInt, gte, lte, sum } from "../fraction/fraction";
import type { PauseDecision, PauseEnd } from "../pause/pause";
import { sessionResultsArbitrary, weightPercentPartition } from "../test-support/arbitraries";
import { buildDoneCommitment, buildDoneEntry, buildPauseRequest } from "../test-support/builders";
import { scorePerSessionCommitment } from "./commitment-score";
import type { ScoreInput } from "./member-score";
import { scoreMember } from "./member-score";

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
          const { points } = scorePerSessionCommitment(weightPercent, sessions);
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
              scorePerSessionCommitment(weightPercent, sessionsPerCommitment[i] ?? []).points,
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

/** Arbitrary per-commitment fuzz: a `timesPerWeek` cadence, some scattered `done` entries, and 0-2 pause requests (any shape -- `pause.ts`'s day-range helpers already tolerate an empty/inverted range without throwing). */
function commitmentFuzzArbitrary() {
  return record({
    times: integer({ min: 1, max: 5 }),
    entryDays: array(integer({ min: 0, max: propertyTotalDays - 1 }), { maxLength: 10 }),
    pauses: array(
      record({
        startDay: integer({ min: 0, max: propertyTotalDays - 1 }),
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

/**
 * F9's full-pipeline equivalent (requested by the fresh review after slice
 * 6a, task 6b.9): `0 <= scoreMember(input).points <= 1000` for arbitrary
 * `ScoreInput`s -- arbitrary commitments (via `weightPercentPartition`),
 * arbitrary entries, arbitrary pauses (any shape, including retroactive-
 * looking or degenerate ones -- `scoreMember` never throws on those, it
 * just scores whatever `pauseAwareWeekSessions` resolves) and an arbitrary
 * `today` anywhere from the season's start through a few days past its end.
 * This exercises the WHOLE composition -- R1's so-far gating, D9's pause
 * cap, D12's mid-season redistribution -- catching a regression in how
 * `scoreMember` sums/gates commitment points that slice 6a's per-commitment-
 * only property test (F9, above) cannot see, now that R1 makes a mid-season
 * `today` a normal input rather than an unsafe one.
 */
describe("scoring invariants (F9 full pipeline, property-based, slice 6b)", () => {
  it("0 <= scoreMember(input).points <= 1000, for arbitrary commitments/entries/pauses/today", () => {
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
          const commitments = weights.map((weightPercent, i) =>
            buildDoneCommitment(`c${i}`, weightPercent, {
              kind: "timesPerWeek",
              times: fuzzes[i]?.times ?? 1,
            }),
          );
          const entries = weights.flatMap((_, i) =>
            (fuzzes[i]?.entryDays ?? []).map((day) => buildDoneEntry(`c${i}`, day)),
          );
          const pauses = weights.flatMap((_, i) =>
            (fuzzes[i]?.pauses ?? []).map((p) => {
              const uncappedLastDay = p.startDay + p.length;
              const lastDay = seasonDay(
                uncappedLastDay < propertyTotalDays ? uncappedLastDay : propertyTotalDays - 1,
              );
              const end: PauseEnd =
                p.endKind === "open" ? { kind: "open" } : { kind: "fixed", lastDay };
              const decision: PauseDecision =
                p.decisionKind === "pending"
                  ? { kind: "pending" }
                  : p.decisionKind === "approved"
                    ? { kind: "approved", decidedOn: seasonDay(p.startDay), resumedOn: null }
                    : { kind: "rejected", decidedOn: seasonDay(p.startDay) };
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
          expect(gte(score.points, ZERO)).toBe(true);
          expect(lte(score.points, TOTAL_POTENTIAL_POINTS)).toBe(true);
        },
      ),
    );
  });
});
