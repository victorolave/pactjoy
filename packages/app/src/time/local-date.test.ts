import { assert, integer, property } from "fast-check";
import { describe, expect, it } from "vitest";
import { epochDay, localDate, localDateOfEpochDay } from "./local-date.ts";

/** epochDay of 2500-12-31 (Date.UTC(2500, 11, 31) / 86_400_000) -- the wide range design asked this property to cover (1970-2500). */
const MAX_EPOCH_DAY_2500 = 193_943;

describe("localDate", () => {
  it("brands a real YYYY-MM-DD calendar date", () => {
    expect(localDate("2026-10-01")).toBe("2026-10-01");
  });

  it("accepts a leap day on a leap year", () => {
    expect(localDate("2028-02-29")).toBe("2028-02-29");
  });

  it("rejects a malformed format", () => {
    expect(() => localDate("2026/10/01")).toThrow(RangeError);
  });

  it("rejects a day that doesn't exist in the given month", () => {
    expect(() => localDate("2026-04-31")).toThrow(RangeError);
  });

  it("rejects Feb 29 on a non-leap year", () => {
    expect(() => localDate("2026-02-29")).toThrow(RangeError);
  });

  it("rejects a year before 1970 (out of this app's domain)", () => {
    expect(() => localDate("1969-12-31")).toThrow(RangeError);
  });
});

describe("epochDay", () => {
  it("returns 0 for the epoch itself", () => {
    expect(epochDay(localDate("1970-01-01"))).toBe(0);
  });

  it("matches known calendar-date offsets", () => {
    expect(epochDay(localDate("2000-01-01"))).toBe(10957);
    expect(epochDay(localDate("2026-01-01"))).toBe(20454);
    expect(epochDay(localDate("2026-10-01"))).toBe(20727);
    expect(epochDay(localDate("2028-02-29"))).toBe(21243);
  });

  it("increases by exactly 1 across a leap-day boundary", () => {
    expect(epochDay(localDate("2028-03-01")) - epochDay(localDate("2028-02-29"))).toBe(1);
  });
});

describe("localDateOfEpochDay", () => {
  it("is the exact inverse of epochDay across a range of dates", () => {
    const dates = [
      "1970-01-01",
      "2000-01-01",
      "2026-01-01",
      "2026-10-01",
      "2028-02-29",
      "2028-03-01",
    ];
    for (const date of dates) {
      const day = epochDay(localDate(date));
      expect(localDateOfEpochDay(day)).toBe(date);
    }
  });
});

describe("epochDay <-> localDateOfEpochDay round-trip (property-based, fast-check)", () => {
  it("round-trips every epoch day from 1970-01-01 through 2500-12-31", () => {
    assert(
      property(integer({ min: 0, max: MAX_EPOCH_DAY_2500 }), (day) => {
        expect(epochDay(localDateOfEpochDay(day))).toBe(day);
      }),
    );
  });
});
