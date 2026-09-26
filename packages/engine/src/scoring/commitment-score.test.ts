import { describe, expect, it } from "vitest";
import { fromInt } from "../fraction/fraction";
import { scorePerSessionCommitment } from "./commitment-score";

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

  it("returns points 0 and null consistency for zero counted opportunities (R6)", () => {
    const score = scorePerSessionCommitment(25, []);
    expect(score.points).toEqual(fromInt(0));
    expect(score.consistency).toBeNull();
  });
});
