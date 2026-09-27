import { describe, expect, it } from "vitest";
import { isConsistent, progressOf } from "../progress/progress";
import { bLimitRows } from "./rows/b-limit.rows";

describe("acceptance: series B — limit", () => {
  it.for(bLimitRows)("$id: $summary", (row) => {
    expect(progressOf(row.target, row.value)).toEqual(row.expectedProgress);
    expect(isConsistent(row.target, row.value)).toBe(row.expectedConsistent);
  });
});
