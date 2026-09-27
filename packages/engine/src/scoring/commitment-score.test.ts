import { describe, expect, it } from "vitest";
import { fromInt } from "../fraction/fraction";
import { fr } from "../test-support/fraction-literal";
import { scoreCommitmentSoFar, scorePerSessionCommitment } from "./commitment-score";

describe("scorePerSessionCommitment", () => {
  it("computes points as weight x 1000 x mean(progress), and consistency as reached/total", () => {
    const sessions = [
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: null, progress: fromInt(0), consistent: false },
    ];
    const score = scorePerSessionCommitment(30, sessions);
    // weight 30% x 1000 x mean([1,1,0]) = 300 x 2/3 = 200
    expect(score.points).toEqual({ num: 200n, den: 1n });
    expect(score.consistency).toEqual({ num: 2n, den: 3n });
  });

  it("computes idealCompletion as mean progress (D1) — distinct from consistency when progress is partial", () => {
    const sessions = [
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: fromInt(1), progress: fr("1/2"), consistent: true },
      { value: null, progress: fromInt(0), consistent: false },
    ];
    const score = scorePerSessionCommitment(100, sessions);
    // consistency = 2/3 (two of three reach); idealCompletion = mean(1, 1/2, 0) = 1/2 — the two metrics differ (D1).
    expect(score.consistency).toEqual(fr("2/3"));
    expect(score.idealCompletion).toEqual(fr("1/2"));
  });

  it("returns points 0 and null consistency/idealCompletion for zero counted opportunities (R6)", () => {
    const score = scorePerSessionCommitment(25, []);
    expect(score.points).toEqual(fromInt(0));
    expect(score.consistency).toBeNull();
    expect(score.idealCompletion).toBeNull();
  });
});

describe("scoreCommitmentSoFar (D12: mid-season recompute, R1-gated numerator over the whole-season denominator)", () => {
  it("matches scorePerSessionCommitment exactly when soFarSessions === allSessions (end-of-season backward compatibility)", () => {
    const sessions = [
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: fromInt(1), progress: fr("1/2"), consistent: true },
      { value: null, progress: fromInt(0), consistent: false },
    ];
    expect(scoreCommitmentSoFar(100, sessions, sessions)).toEqual(
      scorePerSessionCommitment(100, sessions),
    );
  });

  it("D12: value of each opportunity = potential / allSessions.length — numerator only sums the so-far subset", () => {
    // 4 active opportunities of the whole season (allSessions), 2 already counted so far, both at 100%.
    const allSessions = [
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: null, progress: fromInt(0), consistent: false },
      { value: null, progress: fromInt(0), consistent: false },
    ];
    const soFarSessions = allSessions.slice(0, 2);
    const score = scoreCommitmentSoFar(100, allSessions, soFarSessions);
    // potential = 100 x 10 = 1000; points = 1000 x (1+1)/4 = 500 -- NOT 1000x mean(soFar)=1000.
    expect(score.points).toEqual(fromInt(500));
    expect(score.consistency).toEqual(fr("2/4"));
    expect(score.idealCompletion).toEqual(fr("2/4"));
  });

  it("returns points 0 and null consistency/idealCompletion when nothing is counted so far yet (R6, e.g. day 0 of the season)", () => {
    const allSessions = [
      { value: null, progress: fromInt(0), consistent: false },
      { value: null, progress: fromInt(0), consistent: false },
    ];
    const score = scoreCommitmentSoFar(50, allSessions, []);
    expect(score.points).toEqual(fromInt(0));
    expect(score.consistency).toBeNull();
    expect(score.idealCompletion).toBeNull();
  });
});
