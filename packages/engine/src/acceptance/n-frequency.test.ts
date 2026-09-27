import { describe, expect, it } from "vitest";
import { mean } from "../fraction/fraction";
import { weeklyTotalResult } from "../opportunity/weekly-total";
import { specificDaysSessions, timesPerWeekSessions } from "../opportunity/per-session";
import { computeStreak, weekStreakOutcome } from "../scoring/streak";
import { dibujarWeekdays, nFrequencyRows, nFrequencySeason, nStreakRows } from "./rows/n-frequency.rows";

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

describe("acceptance: series N — streak (D11)", () => {
  it.for(nStreakRows)("$id: $summary", (row) => {
    const outcomes = row.weeksEntries.map((entries, week) => {
      const sessions =
        row.kind === "timesPerWeek"
          ? timesPerWeekSessions(row.target, row.slots, entries)
          : [weeklyTotalResult(row.target, week, entries)];
      return weekStreakOutcome(false, sessions);
    });
    expect(computeStreak("week", outcomes)).toEqual({
      unit: "week",
      current: row.expectedCurrent,
      best: row.expectedBest,
    });
  });
});
