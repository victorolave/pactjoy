import { describe, expect, it } from "vitest";
import { circleId, seasonId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import {
  buildSeason,
  canCreateSeasonFor,
  isReviewCadenceWeeks,
  isSeasonLengthWeeks,
  reviewCadenceForLength,
  validateStartDateWindow,
} from "./season.ts";

const NOW = instant(1_700_000_000_000);

describe("buildSeason", () => {
  it("new SS-17 (B1): every season is created directly with its pact open, never draft", () => {
    const season = buildSeason({
      id: seasonId("season-1"),
      circleId: circleId("circle-1"),
      timeZone: timeZoneId("America/Santiago"),
      nominalStart: localDate("2026-10-01"),
      lengthWeeks: 8,
      reviewCadenceWeeks: 2,
      now: NOW,
    });

    expect(season.status).toBe("pactOpen");
    expect(season.actualStart).toBeNull();
    expect(season.version).toBe(0);
    expect(season.nominalStart).toBe("2026-10-01");
  });

  it("S5: a brand-new season has no commitments yet", () => {
    const season = buildSeason({
      id: seasonId("season-1"),
      circleId: circleId("circle-1"),
      timeZone: timeZoneId("America/Santiago"),
      nominalStart: localDate("2026-10-01"),
      lengthWeeks: 8,
      reviewCadenceWeeks: 2,
      now: NOW,
    });

    expect(season.commitments).toEqual([]);
  });

  it("S6: a brand-new season has no approvals and an open (null) pactClosedAt", () => {
    const season = buildSeason({
      id: seasonId("season-1"),
      circleId: circleId("circle-1"),
      timeZone: timeZoneId("America/Santiago"),
      nominalStart: localDate("2026-10-01"),
      lengthWeeks: 8,
      reviewCadenceWeeks: 2,
      now: NOW,
    });

    expect(season.approvals).toEqual([]);
    expect(season.pactClosedAt).toBeNull();
  });
});

describe("reviewCadenceForLength", () => {
  it("SS-6: defaults to 2 for an 8-week season", () => {
    expect(reviewCadenceForLength(8)).toBe(2);
  });

  it("defaults per length for every valid length (Notion Mecánicas)", () => {
    expect(reviewCadenceForLength(4)).toBe(1);
    expect(reviewCadenceForLength(6)).toBe(2);
    expect(reviewCadenceForLength(12)).toBe(3);
  });
});

describe("validateStartDateWindow", () => {
  it("SS-4: a start date 31 days ahead is rejected", () => {
    const today = localDate("2026-09-28");
    const startDate = localDate("2026-10-29"); // 31 days ahead

    expect(validateStartDateWindow(startDate, today)).toEqual({ kind: "StartDateTooFarAhead" });
  });

  it("SS-5: a start date of yesterday is rejected", () => {
    const today = localDate("2026-09-28");
    const startDate = localDate("2026-09-27");

    expect(validateStartDateWindow(startDate, today)).toEqual({ kind: "StartDateInPast" });
  });

  it("accepts today and exactly 30 days ahead (inclusive window, A6)", () => {
    const today = localDate("2026-09-28");

    expect(validateStartDateWindow(today, today)).toBeNull();
    expect(validateStartDateWindow(localDate("2026-10-28"), today)).toBeNull();
  });
});

describe("canCreateSeasonFor", () => {
  it("CM-12 delta (B1): allows creation when the circle never had a season", () => {
    expect(canCreateSeasonFor(null)).toBe(true);
  });

  it("CM-12 delta (B1): allows creation when the circle's latest season is closed", () => {
    const closed = buildSeason({
      id: seasonId("season-1"),
      circleId: circleId("circle-1"),
      timeZone: timeZoneId("America/Santiago"),
      nominalStart: localDate("2026-10-01"),
      lengthWeeks: 4,
      reviewCadenceWeeks: 1,
      now: NOW,
    });

    expect(canCreateSeasonFor({ ...closed, status: "closed" })).toBe(true);
  });

  it("CM-12 delta (B1): rejects creation while the latest season is pactOpen or active", () => {
    const open = buildSeason({
      id: seasonId("season-1"),
      circleId: circleId("circle-1"),
      timeZone: timeZoneId("America/Santiago"),
      nominalStart: localDate("2026-10-01"),
      lengthWeeks: 4,
      reviewCadenceWeeks: 1,
      now: NOW,
    });

    expect(canCreateSeasonFor(open)).toBe(false);
    expect(canCreateSeasonFor({ ...open, status: "active" })).toBe(false);
  });
});

describe("isSeasonLengthWeeks", () => {
  it("accepts 4, 6, 8 and 12; rejects everything else (the HTTP adapter has no compile-time guarantee)", () => {
    expect(isSeasonLengthWeeks(4)).toBe(true);
    expect(isSeasonLengthWeeks(6)).toBe(true);
    expect(isSeasonLengthWeeks(8)).toBe(true);
    expect(isSeasonLengthWeeks(12)).toBe(true);
    expect(isSeasonLengthWeeks(5)).toBe(false);
    expect(isSeasonLengthWeeks(0)).toBe(false);
    expect(isSeasonLengthWeeks(-4)).toBe(false);
  });
});

describe("isReviewCadenceWeeks", () => {
  it("accepts 1, 2 and 3; rejects everything else", () => {
    expect(isReviewCadenceWeeks(1)).toBe(true);
    expect(isReviewCadenceWeeks(2)).toBe(true);
    expect(isReviewCadenceWeeks(3)).toBe(true);
    expect(isReviewCadenceWeeks(4)).toBe(false);
    expect(isReviewCadenceWeeks(0)).toBe(false);
  });
});
