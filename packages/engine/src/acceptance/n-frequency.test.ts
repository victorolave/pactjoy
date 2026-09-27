import { describe, expect, it } from "vitest";
import { mean } from "../fraction/fraction";
import { specificDaysSessions, timesPerWeekSessions } from "../opportunity/per-session";
import type { ScoreInput } from "../scoring/member-score";
import { scoreMember } from "../scoring/member-score";
import {
  dibujarWeekdays,
  nFrequencyRows,
  nFrequencySeason,
  nStreakRows,
} from "./rows/n-frequency.rows";

describe("acceptance: series N — timesPerWeek and specificDays frequency", () => {
  it.for(nFrequencyRows)("$id: $summary", (row) => {
    const sessions =
      row.kind === "timesPerWeek"
        ? timesPerWeekSessions(row.target, row.slots, row.entries)
        : specificDaysSessions(row.target, nFrequencySeason, 0, dibujarWeekdays, row.entries);

    expect(sessions).toHaveLength(row.slots);
    expect(sessions.filter((s) => s.consistent)).toHaveLength(row.expectedConsistentCount);
    if (row.expectedWeekProgress !== null) {
      expect(mean(sessions.map((s) => s.progress))).toEqual(row.expectedWeekProgress);
    }
  });
});

/**
 * D11 streak, exercised through `scoreMember` ONLY (fresh-review BLOCKER
 * fix) — no direct composition of the dispatchers + `weekStreakOutcome` +
 * `computeStreak` in this test body; that composition now lives in
 * `scoring/member-score.ts`'s own `seasonSessions`, the single production
 * path.
 */
describe("acceptance: series N — streak (D11)", () => {
  it.for(nStreakRows)("$id: $summary", (row) => {
    const input: ScoreInput = {
      season: row.season,
      commitments: [row.commitment],
      entries: row.entries,
      pauses: [],
      today: row.today,
    };
    const score = scoreMember(input);
    expect(score.commitments[0]?.streak).toEqual({
      unit: "week",
      current: row.expectedCurrent,
      best: row.expectedBest,
    });
  });
});
