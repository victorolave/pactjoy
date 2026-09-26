import { describe, expect, it } from "vitest";
import { weeklyTotalResult } from "../opportunity/weekly-total";
import { cWeeklyTotalRows } from "./rows/c-weekly-total.rows";

describe("acceptance: series C — weeklyTotal", () => {
  it.for(cWeeklyTotalRows)("$id: $summary", (row) => {
    for (const weekCase of row.weeks) {
      const result = weeklyTotalResult(row.target, weekCase.week, weekCase.entries);
      expect(result.progress).toEqual(weekCase.expectedProgress);
      expect(result.consistent).toBe(weekCase.expectedConsistent);
    }
  });
});
