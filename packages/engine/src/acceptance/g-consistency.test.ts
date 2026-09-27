import { describe, expect, it } from "vitest";
import { scorePerSessionCommitment } from "../scoring/commitment-score";
import { gConsistencyRows } from "./rows/g-consistency.rows";

describe("acceptance: series G — consistency and idealCompletion per commitment (D1)", () => {
  it.for(gConsistencyRows)("$id: $summary", (row) => {
    const score = scorePerSessionCommitment(row.weightPercent, row.sessions);
    expect(score.consistency).toEqual(row.expectedConsistency);
    expect(score.idealCompletion).toEqual(row.expectedIdealCompletion);
  });

  it.todo(
    "G5-G6: participant consistency/idealCompletion (D2) — needs Notion week-by-week entries for scoreMember's ScoreInput (not available to this apply batch)",
  );
});
