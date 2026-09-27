import { describe, expect, it } from "vitest";
import { sum } from "../fraction/fraction";
import { scorePerSessionCommitment } from "../scoring/commitment-score";
import type { ScoreInput } from "../scoring/member-score";
import { scoreMember } from "../scoring/member-score";
import { fCommitmentRows, fMidSeasonRows, fTotalRows } from "./rows/f-full-season.rows";

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

  // F5 (participant season total) is exercised in
  // `participant-full-season.test.ts`, via `scoreMember`'s full `ScoreInput`.

  it.for(fMidSeasonRows)("$id: $summary", (row) => {
    const input: ScoreInput = {
      season: row.season,
      commitments: [row.commitment],
      entries: row.entries,
      pauses: row.pauses,
      today: row.today,
    };
    expect(scoreMember(input).points).toEqual(row.expectedPoints);
  });
});
