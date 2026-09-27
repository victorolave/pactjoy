import { describe, expect, it } from "vitest";
import { fromInt } from "../fraction/fraction";
import { fr } from "../test-support/fraction-literal";
import { scoreCommitmentSoFar } from "./commitment-score";

describe("scoreCommitmentSoFar — end of season (soFarSessions === allSessions)", () => {
  it("computes points as weight x 1000 x mean(progress), and consistency as reached/total", () => {
    const sessions = [
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: null, progress: fromInt(0), consistent: false },
    ];
    const score = scoreCommitmentSoFar(30, sessions, sessions);
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
    const score = scoreCommitmentSoFar(100, sessions, sessions);
    // consistency = 2/3 (two of three reach); idealCompletion = mean(1, 1/2, 0) = 1/2 — the two metrics differ (D1).
    expect(score.consistency).toEqual(fr("2/3"));
    expect(score.idealCompletion).toEqual(fr("1/2"));
  });

  it("returns points 0 and null consistency/idealCompletion for zero counted opportunities (R6)", () => {
    const score = scoreCommitmentSoFar(25, [], []);
    expect(score.points).toEqual(fromInt(0));
    expect(score.consistency).toBeNull();
    expect(score.idealCompletion).toBeNull();
  });
});

describe("scoreCommitmentSoFar — mid-season (D12 points, R7 consistency/idealCompletion)", () => {
  it("D12: points redistribute over allSessions.length (the whole season), not soFarSessions.length", () => {
    // 4 active opportunities of the whole season (allSessions), 2 already counted so far, both at 100%.
    const allSessions = [
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: null, progress: fromInt(0), consistent: false },
      { value: null, progress: fromInt(0), consistent: false },
    ];
    const soFarSessions = allSessions.slice(0, 2);
    const score = scoreCommitmentSoFar(100, allSessions, soFarSessions);
    // potential = 100 x 10 = 1000; points = 1000 x (1+1)/4 = 500 -- the season's own denominator (4), not soFar's (2).
    expect(score.points).toEqual(fromInt(500));
  });

  it("R7: consistency/idealCompletion divide by soFarSessions.length, NOT allSessions.length — both are 100% here even though only half the season's opportunities are in yet", () => {
    const allSessions = [
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: null, progress: fromInt(0), consistent: false },
      { value: null, progress: fromInt(0), consistent: false },
    ];
    const soFarSessions = allSessions.slice(0, 2); // both reached, both at 100% -- perfect so far
    const score = scoreCommitmentSoFar(100, allSessions, soFarSessions);
    expect(score.consistency).toEqual(fromInt(1)); // 2/2, not 2/4
    expect(score.idealCompletion).toEqual(fromInt(1)); // 2/2, not 2/4
  });

  it("R7: idealCompletion != points/potential mid-season (the two use different denominators) — only coincide at season end", () => {
    const allSessions = [
      { value: fromInt(1), progress: fromInt(1), consistent: true },
      { value: null, progress: fromInt(0), consistent: false },
      { value: null, progress: fromInt(0), consistent: false },
      { value: null, progress: fromInt(0), consistent: false },
    ];
    const soFarSessions = allSessions.slice(0, 1); // 1 of 4 counted, fully reached
    const score = scoreCommitmentSoFar(100, allSessions, soFarSessions);
    // points/potential = (1000 x 1/4)/1000 = 1/4 -- but idealCompletion = 1/1 = 1 (only what's counted).
    expect(score.points).toEqual(fromInt(250));
    expect(score.idealCompletion).toEqual(fromInt(1));
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
