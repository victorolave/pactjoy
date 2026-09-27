import { describe, expect, it } from "vitest";
import { isConsistent, progressOf } from "../progress/progress";
import { aReachPerSessionRows } from "./rows/a-reach-per-session.rows";

describe("acceptance: series A — reach, perSession", () => {
  it.for(aReachPerSessionRows)("$id: $summary", (row) => {
    expect(progressOf(row.target, row.value)).toEqual(row.expectedProgress);
    expect(isConsistent(row.target, row.value)).toBe(row.expectedConsistent);
  });
});
