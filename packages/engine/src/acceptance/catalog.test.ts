import { describe, expect, it } from "vitest";
import { aReachPerSessionRows } from "./rows/a-reach-per-session.rows";
import { bLimitRows } from "./rows/b-limit.rows";
import { cWeeklyTotalRows } from "./rows/c-weekly-total.rows";
import {
  eAllCommitmentsPause,
  eAutoResumeRows,
  eConsistencyRows,
  eLifecycleRows,
  eNeutralPointsRows,
  ePauseCapRows,
  ePausedDaySessionRows,
  eSessionCountRows,
  eWeeklyProrationRows,
} from "./rows/e-pause.rows";
import { F9_ID, fCommitmentRows, fTotalRows } from "./rows/f-full-season.rows";
import { gConsistencyRows } from "./rows/g-consistency.rows";
import { nFrequencyRows } from "./rows/n-frequency.rows";
import { F5_ID, G5_ID, G6_ID } from "./rows/participant-full-season.rows";

const ePauseRowIds = [
  ...eNeutralPointsRows,
  ...eSessionCountRows,
  ...eWeeklyProrationRows,
  ...ePausedDaySessionRows,
  ...eLifecycleRows,
  { id: eAllCommitmentsPause.id },
  ...eConsistencyRows,
  ...ePauseCapRows,
  ...eAutoResumeRows,
].map((row) => row.id);

/**
 * Pins the full 96-row worked-example catalog (ADR-0005). Families not yet
 * implemented are `it.todo` placeholders, flipped to real assertions as
 * each slice lands them. Final counts once all slices land:
 * A12 B14 C15 N13 E23 F13 G6 = 96.
 */
describe("acceptance catalog", () => {
  it("has unique row IDs across every implemented family", () => {
    const ids = [...aReachPerSessionRows, ...bLimitRows, ...cWeeklyTotalRows, ...nFrequencyRows]
      .map((row) => row.id)
      .concat(ePauseRowIds)
      .concat(fCommitmentRows.map((row) => row.id))
      .concat(fTotalRows.map((row) => row.id))
      .concat([F9_ID, F5_ID])
      .concat(gConsistencyRows.map((row) => row.id))
      .concat([G5_ID, G6_ID]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pins the final row count for series A: 12 of 12", () => {
    expect(aReachPerSessionRows.length).toBe(12);
  });

  it("pins the final row count for series B: 14 of 14", () => {
    expect(bLimitRows.length).toBe(14);
  });

  it("pins the final row count for series C: 15 of 15", () => {
    expect(cWeeklyTotalRows.length).toBe(15);
  });

  it("pins the row count for series N so far: 11 of 13 (N12-N13 need streak, slice 6b)", () => {
    expect(nFrequencyRows.length).toBe(11);
  });

  it.todo("series N: streak rows N12-N13 — slice 6b");

  it("pins the final row count for series E: 23 of 23", () => {
    expect(ePauseRowIds.length).toBe(23);
  });

  it("pins the row count for series F so far: 9 of 13 (F1-F9 done; F10-F13 need slice 6b's mid-season recompute)", () => {
    expect(fCommitmentRows.length + fTotalRows.length + 1 + 1).toBe(9);
  });

  it.todo("series F: F10-F13 (mid-season recompute) — slice 6b");

  it("pins the final row count for series G: 6 of 6", () => {
    expect(gConsistencyRows.length + 2).toBe(6);
  });
});
