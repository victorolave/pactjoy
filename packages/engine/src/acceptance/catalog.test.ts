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
      .concat([F9_ID])
      .concat(gConsistencyRows.map((row) => row.id));
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

  it("pins the row count for series F so far: 8 of 13 (F1-F4, F6-F9 done; F5 and F10-F13 need Notion week-by-week entries / slice 6b)", () => {
    expect(fCommitmentRows.length + fTotalRows.length + 1).toBe(8);
  });

  it.todo(
    "series F: F5 (participant total) — needs Notion week-by-week entries (not available to this apply batch)",
  );
  it.todo("series F: F10-F13 (mid-season recompute) — slice 6b");

  it("pins the row count for series G so far: 4 of 6 (G1-G4 done; G5-G6 need Notion week-by-week entries)", () => {
    expect(gConsistencyRows.length).toBe(4);
  });

  it.todo(
    "series G: G5-G6 (participant consistency/idealCompletion) — needs Notion week-by-week entries (not available to this apply batch)",
  );
});
