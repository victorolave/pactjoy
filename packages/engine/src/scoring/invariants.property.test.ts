import { array, assert, integer, property, tuple } from "fast-check";
import { describe, expect, it } from "vitest";
import { fromInt, gte, lte, sum } from "../fraction/fraction";
import { sessionResultsArbitrary, weightPercentPartition } from "../test-support/arbitraries";
import { scorePerSessionCommitment } from "./commitment-score";

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
