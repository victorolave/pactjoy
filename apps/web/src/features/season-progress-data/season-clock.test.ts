import { describe, expect, it } from "vitest";
import { nextSeasonDayStartMs, seasonDate } from "./season-clock.ts";

const at = (iso: string) => Date.parse(iso);

describe("seasonDate", () => {
  it("is the day in the season's zone, not the device's or UTC", () => {
    expect(seasonDate(at("2026-12-31T23:30:00Z"), "Pacific/Auckland")).toBe("2027-01-01");
    expect(seasonDate(at("2026-10-01T03:00:00Z"), "America/Bogota")).toBe("2026-09-30");
  });
});

describe("nextSeasonDayStartMs", () => {
  it("is the next local midnight on an ordinary day", () => {
    expect(nextSeasonDayStartMs(at("2026-09-24T10:00:00Z"), "Europe/Madrid")).toBe(
      at("2026-09-24T22:00:00Z"),
    );
  });

  it("follows a 25-hour day when the clocks go back", () => {
    // Madrid leaves summer time at 03:00 on 2026-10-25: that day lasts 25 hours.
    expect(nextSeasonDayStartMs(at("2026-10-24T22:30:00Z"), "Europe/Madrid")).toBe(
      at("2026-10-25T23:00:00Z"),
    );
  });

  it("follows a 23-hour day when the clocks go forward", () => {
    expect(nextSeasonDayStartMs(at("2026-03-28T23:30:00Z"), "Europe/Madrid")).toBe(
      at("2026-03-29T22:00:00Z"),
    );
  });

  it("starts the next day even exactly at midnight", () => {
    expect(nextSeasonDayStartMs(at("2026-09-24T22:00:00Z"), "Europe/Madrid")).toBe(
      at("2026-09-25T22:00:00Z"),
    );
  });
});
