import { describe, expect, it } from "vitest";
import { aReachPerSessionRows } from "./rows/a-reach-per-session.rows.ts";
import { bLimitRows } from "./rows/b-limit.rows.ts";
import { cWeeklyTotalRows } from "./rows/c-weekly-total.rows.ts";
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
} from "./rows/e-pause.rows.ts";
import { F9_ID, fCommitmentRows, fMidSeasonRows, fTotalRows } from "./rows/f-full-season.rows.ts";
import { gConsistencyRows } from "./rows/g-consistency.rows.ts";
import { nFrequencyRows, nStreakRows } from "./rows/n-frequency.rows.ts";
import { F5_ID, G5_ID, G6_ID } from "./rows/participant-full-season.rows.ts";

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
 * Pins the full 96-row worked-example catalog (ADR-0005), final:
 * A12 B14 C15 N13 E23 F13 G6 = 96.
 */
describe("acceptance catalog", () => {
  it("has unique row IDs across every implemented family", () => {
    const ids = [
      ...aReachPerSessionRows,
      ...bLimitRows,
      ...cWeeklyTotalRows,
      ...nFrequencyRows,
      ...nStreakRows,
    ]
      .map((row) => row.id)
      .concat(ePauseRowIds)
      .concat(fCommitmentRows.map((row) => row.id))
      .concat(fTotalRows.map((row) => row.id))
      .concat(fMidSeasonRows.map((row) => row.id))
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

  it("pins the final row count for series N: 13 of 13", () => {
    expect(nFrequencyRows.length + nStreakRows.length).toBe(13);
  });

  it("pins the final row count for series E: 23 of 23", () => {
    expect(ePauseRowIds.length).toBe(23);
  });

  it("pins the final row count for series F: 13 of 13", () => {
    expect(fCommitmentRows.length + fTotalRows.length + fMidSeasonRows.length + 1 + 1).toBe(13);
  });

  it("pins the final row count for series G: 6 of 6", () => {
    expect(gConsistencyRows.length + 2).toBe(6);
  });

  it("pins the final total row count: 96", () => {
    const total =
      aReachPerSessionRows.length +
      bLimitRows.length +
      cWeeklyTotalRows.length +
      nFrequencyRows.length +
      nStreakRows.length +
      ePauseRowIds.length +
      fCommitmentRows.length +
      fTotalRows.length +
      fMidSeasonRows.length +
      1 + // F5
      1 + // F9
      gConsistencyRows.length +
      1 + // G5
      1; // G6
    expect(total).toBe(96);
  });
});
