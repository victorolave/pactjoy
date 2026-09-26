import { describe, expect, it } from "vitest";
import { mean } from "../fraction/fraction";
import { specificDaysSessions, timesPerWeekSessions } from "../opportunity/per-session";
import { dibujarWeekdays, nFrequencyRows, nFrequencySeason } from "./rows/n-frequency.rows";

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
