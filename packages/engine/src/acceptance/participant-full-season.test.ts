import { describe, expect, it } from "vitest";
import { scoreMember } from "../scoring/member-score.ts";
import { fCommitmentRows } from "./rows/f-full-season.rows.ts";
import { gConsistencyRows } from "./rows/g-consistency.rows.ts";
import {
  expectedParticipantConsistency,
  expectedParticipantIdealCompletion,
  expectedParticipantTotalPoints,
  participantFullSeasonInput,
} from "./rows/participant-full-season.rows.ts";

/** Maps each commitment id in the fixture to its already-verified F/G row id, so the per-commitment breakdown below is checked against F1-F4/G1-G4 rather than new magic numbers. */
const COMMITMENT_TO_ROW_ID: Record<string, string> = {
  leer: "F1",
  ingles: "F2",
  gym: "F3",
  dibujar: "F4",
};

describe("acceptance: series F/G — participant full-season aggregation (D1/D2, scoreMember)", () => {
  const score = scoreMember(participantFullSeasonInput);

  it("F5: participant season total across all four commitments", () => {
    expect(score.points).toEqual(expectedParticipantTotalPoints);
  });

  it("G5: participant consistency is Sigma(reached)/Sigma(opportunities), not an average of the four ratios (D2)", () => {
    expect(score.consistency).toEqual(expectedParticipantConsistency);
  });

  it("G6: participant idealCompletion is totalPoints / 1000 (D2)", () => {
    expect(score.idealCompletion).toEqual(expectedParticipantIdealCompletion);
  });

  it("wires pauseAwareWeekSessions per commitment: each commitment's own breakdown matches its already-verified F/G row (task 6a.11)", () => {
    for (const entry of score.commitments) {
      const rowId = COMMITMENT_TO_ROW_ID[entry.commitmentId];
      const fRow = fCommitmentRows.find((row) => row.id === rowId);
      const gRow = gConsistencyRows.find((row) => row.id === rowId?.replace("F", "G"));
      expect(fRow, `no F row for commitment "${entry.commitmentId}"`).toBeDefined();
      expect(gRow, `no G row for commitment "${entry.commitmentId}"`).toBeDefined();
      expect(entry.points).toEqual(fRow?.expectedPoints);
      expect(entry.consistency).toEqual(gRow?.expectedConsistency);
      expect(entry.idealCompletion).toEqual(gRow?.expectedIdealCompletion);
    }
  });
});
