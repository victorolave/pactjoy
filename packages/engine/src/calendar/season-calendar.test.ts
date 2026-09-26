import { describe, expect, it } from "vitest";
import type { Season } from "./season-calendar";
import { assertValidSeasonDay, daysOfWeek, seasonDay, weekdayOf, weekOf } from "./season-calendar";

describe("seasonDay", () => {
  it("accepts a non-negative safe integer as a SeasonDay", () => {
    expect(seasonDay(0)).toBe(0);
    expect(seasonDay(41)).toBe(41);
  });

  it("throws RangeError for a negative day", () => {
    expect(() => seasonDay(-1)).toThrow(RangeError);
  });

  it("throws RangeError for a non-integer day", () => {
    expect(() => seasonDay(1.5)).toThrow(RangeError);
  });
});

describe("weekOf", () => {
  it("maps day 0 to week 0", () => {
    expect(weekOf(seasonDay(0))).toBe(0);
  });

  it("maps day 6 (last day of the first week) to week 0", () => {
    expect(weekOf(seasonDay(6))).toBe(0);
  });

  it("maps day 7 (first day of the second week) to week 1", () => {
    expect(weekOf(seasonDay(7))).toBe(1);
  });

  it("maps day 41 to week 5", () => {
    expect(weekOf(seasonDay(41))).toBe(5);
  });
});

describe("weekdayOf", () => {
  const monday: Season = { lengthWeeks: 8, startWeekday: 0 };
  const wednesday: Season = { lengthWeeks: 8, startWeekday: 2 };

  it("returns the season's own startWeekday for day 0", () => {
    expect(weekdayOf(monday, seasonDay(0))).toBe(0);
    expect(weekdayOf(wednesday, seasonDay(0))).toBe(2);
  });

  it("wraps around after 7 days back to the startWeekday", () => {
    expect(weekdayOf(monday, seasonDay(7))).toBe(0);
  });

  it("advances by one weekday per day, wrapping past Sunday (6) back to Monday (0)", () => {
    expect(weekdayOf(wednesday, seasonDay(4))).toBe(6);
    expect(weekdayOf(wednesday, seasonDay(5))).toBe(0);
  });
});

describe("assertValidSeasonDay", () => {
  const fourWeeks: Season = { lengthWeeks: 4, startWeekday: 0 };

  it("accepts the last valid day of the season (lengthWeeks * 7 - 1)", () => {
    expect(() => assertValidSeasonDay(fourWeeks, seasonDay(27))).not.toThrow();
  });

  it("accepts day 0", () => {
    expect(() => assertValidSeasonDay(fourWeeks, seasonDay(0))).not.toThrow();
  });

  it("throws RangeError for a day at the season's length boundary (lengthWeeks * 7)", () => {
    expect(() => assertValidSeasonDay(fourWeeks, seasonDay(28))).toThrow(RangeError);
  });

  it("throws RangeError for a day well past the season's end", () => {
    expect(() => assertValidSeasonDay(fourWeeks, seasonDay(100))).toThrow(RangeError);
  });
});

describe("daysOfWeek", () => {
  it("lists all 7 weekdays starting at Monday (0)", () => {
    expect(daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
