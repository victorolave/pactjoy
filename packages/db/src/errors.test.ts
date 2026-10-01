import { ConcurrencyConflict } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { isRetryable, mapError } from "./errors.ts";

const pgError = (code: string, constraint_name?: string) =>
  Object.assign(new Error(`postgres error ${code}`), { code, constraint_name });

const CONFLICT_CONSTRAINTS = [
  "habits_pkey",
  "circles_pkey",
  "circle_invites_code_key",
  "seasons_pkey",
  "entries_pkey",
  "entries_client_request_key",
];

describe("isRetryable", () => {
  it.each(["40P01", "40001"])("%s (deadlock, serialization failure) is retryable", (code) => {
    expect(isRetryable(pgError(code))).toBe(true);
  });

  it("is false for every other SQLSTATE, a ConcurrencyConflict and non-errors", () => {
    for (const code of ["23505", "23503", "25006", "25P02", "42P01", "55P03"]) {
      expect(isRetryable(pgError(code))).toBe(false);
    }
    expect(isRetryable(new ConcurrencyConflict())).toBe(false);
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable("40001")).toBe(false);
  });
});

describe("mapError", () => {
  it.each(CONFLICT_CONSTRAINTS)("23505 on %s becomes ConcurrencyConflict", (name) => {
    expect(mapError(pgError("23505", name))).toBeInstanceOf(ConcurrencyConflict);
  });

  it("40P01 and 40001 map to ConcurrencyConflict (used once retries are exhausted)", () => {
    expect(mapError(pgError("40P01"))).toBeInstanceOf(ConcurrencyConflict);
    expect(mapError(pgError("40001"))).toBeInstanceOf(ConcurrencyConflict);
  });

  it("the old invite constraint name on circles is not a conflict (the invite moved)", () => {
    const error = pgError("23505", "circles_invite_code_key");
    expect(mapError(error)).toBe(error);
  });

  it("rethrows other unique violations, with or without a constraint name, untouched", () => {
    for (const error of [
      pgError("23505", "circle_members_position_key"),
      pgError("23505", "season_approvals_member_key"),
      pgError("23505"),
    ]) {
      expect(mapError(error)).toBe(error);
    }
  });

  it.each(["23502", "23503", "23514", "25006", "25P02", "42P01"])(
    "%s is a bug or caller error and stays the raw error",
    (code) => {
      const error = pgError(code, "habits_pkey");
      expect(mapError(error)).toBe(error);
      expect(mapError(error)).not.toBeInstanceOf(ConcurrencyConflict);
    },
  );

  it("passes a ConcurrencyConflict and non-errors through untouched", () => {
    const conflict = new ConcurrencyConflict();
    expect(mapError(conflict)).toBe(conflict);
    expect(mapError("oops")).toBe("oops");
    expect(mapError(undefined)).toBeUndefined();
  });
});
