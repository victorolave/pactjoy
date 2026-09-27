import { describe, expect, it } from "vitest";
import { sum } from "../fraction/fraction";
import { scorePerSessionCommitment } from "../scoring/commitment-score";
import { fCommitmentRows, fTotalRows } from "./rows/f-full-season.rows";

describe("acceptance: series F — season totals (D1) and exact-arithmetic rounding-only-at-display", () => {
  it.for(fCommitmentRows)("$id: $summary", (row) => {
    expect(scorePerSessionCommitment(row.weightPercent, row.sessions).points).toEqual(
      row.expectedPoints,
    );
  });

  it.for(fTotalRows)("$id: $summary", (row) => {
    const points = row.commitments.map(
      (commitment) =>
        scorePerSessionCommitment(commitment.weightPercent, commitment.sessions).points,
    );
    expect(sum(points)).toEqual(row.expectedTotal);
  });

  it.todo(
    "F5: participant season total — needs Notion week-by-week entries for scoreMember's ScoreInput (not available to this apply batch)",
  );
  it.todo("F10-F13: mid-season recompute (D12) — slice 6b, needs streak.ts and today-gating");
});
