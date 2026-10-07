import { describe, expect, it } from "vitest";
import { addDays, daysBetween } from "./date.ts";

describe("addDays", () => {
  it("moves a calendar date forward and back", () => {
    expect(addDays("2026-09-28", 27)).toBe("2026-10-25");
    expect(addDays("2026-10-02", 1)).toBe("2026-10-03");
    expect(addDays("2026-10-02", -2)).toBe("2026-09-30");
    expect(addDays("2026-10-02", 0)).toBe("2026-10-02");
  });

  it("crosses month and year ends, and leap days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("does not shift with the machine's time zone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Auckland";
      expect(addDays("2026-10-02", 1)).toBe("2026-10-03");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("returns the input when it is not a date", () => {
    expect(addDays("ayer", 1)).toBe("ayer");
  });
});

describe("daysBetween", () => {
  it("computes whole calendar days between two dates", () => {
    expect(daysBetween("2026-08-23", "2026-08-25")).toBe(2);
    expect(daysBetween("2026-08-25", "2026-08-25")).toBe(0);
    expect(daysBetween("2026-08-26", "2026-08-25")).toBe(-1);
    expect(daysBetween("2026-08-31", "2026-09-01")).toBe(1);
  });

  it("returns 0 for malformed input", () => {
    expect(daysBetween("invalid", "2026-08-25")).toBe(0);
  });
});
