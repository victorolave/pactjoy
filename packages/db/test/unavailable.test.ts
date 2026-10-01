import { ConcurrencyConflict } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { isDatabaseUnavailable } from "../src/unavailable.ts";

const coded = (code: string) => Object.assign(new Error("boom"), { code });

describe("isDatabaseUnavailable", () => {
  it.each([
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "CONNECT_TIMEOUT",
    "CONNECTION_CLOSED",
    "CONNECTION_ENDED",
    "CONNECTION_DESTROYED",
    "08000",
    "08001",
    "08003",
    "08006",
    "08P01",
    "53300",
    "57P01",
    "57P02",
    "57P03",
  ])("is true for code %s", (code) => {
    expect(isDatabaseUnavailable(coded(code))).toBe(true);
  });

  it.each(["23505", "22P02", "40001", "40P01", "42P01", "57014", "53200", "0A000", "X08000", ""])(
    "is false for code %s",
    (code) => {
      expect(isDatabaseUnavailable(coded(code))).toBe(false);
    },
  );

  it("is true for a plain object carrying a connection code", () => {
    expect(isDatabaseUnavailable({ code: "ECONNREFUSED" })).toBe(true);
  });

  it("is false for non-error values and errors without a usable code", () => {
    for (const value of [null, undefined, 0, "08000", new Error("x"), {}, { code: 8000 }])
      expect(isDatabaseUnavailable(value), String(value)).toBe(false);
  });

  it("is false for ConcurrencyConflict", () => {
    expect(isDatabaseUnavailable(new ConcurrencyConflict())).toBe(false);
  });
});
