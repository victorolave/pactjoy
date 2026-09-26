import { describe, expect, it } from "vitest";
import { aReachPerSessionRows } from "./rows/a-reach-per-session.rows";
import { bLimitRows } from "./rows/b-limit.rows";

/**
 * Pins the full 96-row worked-example catalog (ADR-0005). Families not yet
 * implemented are `it.todo` placeholders, flipped to real assertions as
 * each slice lands them. Final counts once all slices land:
 * A12 B14 C15 N13 E23 F13 G6 = 96.
 */
describe("acceptance catalog", () => {
  it("has unique row IDs across every implemented family", () => {
    const ids = [...aReachPerSessionRows, ...bLimitRows].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pins the row count for series A so far: 11 of 12 (A12 needs D4, slice 3)", () => {
    expect(aReachPerSessionRows.length).toBe(11);
  });

  it("pins the final row count for series B: 14 of 14", () => {
    expect(bLimitRows.length).toBe(14);
  });

  it.todo("A12: same-day entry summation (D4) — slice 3");
  it.todo("series C: weekly-total rows — slice 4");
  it.todo("series N: frequency rows — slices 3 and 6b");
  it.todo("series E: pause rows — slices 5a and 5b");
  it.todo("series F: full-season rows — slices 6a and 6b");
  it.todo("series G: consistency rows — slice 6a");
});
