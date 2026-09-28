import { describe, expect, it } from "vitest";
import { sum } from "../fraction/fraction.ts";
import { scoreCommitmentSoFar } from "../scoring/commitment-score.ts";
import type { ScoreInput } from "../scoring/member-score.ts";
import { scoreMember } from "../scoring/member-score.ts";
import { fCommitmentRows, fMidSeasonRows, fTotalRows } from "./rows/f-full-season.rows.ts";

describe("acceptance: series F — season totals (D1) and exact-arithmetic rounding-only-at-display", () => {
  it.for(fCommitmentRows)("$id: $summary", (row) => {
    expect(scoreCommitmentSoFar(row.weightPercent, row.sessions, row.sessions).points).toEqual(
      row.expectedPoints,
    );
  });

  it.for(fTotalRows)("$id: $summary", (row) => {
    const points = row.commitments.map(
      (commitment) =>
        scoreCommitmentSoFar(commitment.weightPercent, commitment.sessions, commitment.sessions)
          .points,
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
