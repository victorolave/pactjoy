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
      .concat(ePauseRowIds);
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

  it.todo("series F: full-season rows — slices 6a and 6b");
  it.todo("series G: consistency rows — slice 6a");
});
