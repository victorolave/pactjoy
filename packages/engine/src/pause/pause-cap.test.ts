import { describe, expect, it } from "vitest";
import type { Season } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import { buildPauseRequest } from "../test-support/builders";
import { canRequestPause, seasonPauseCap } from "./pause-cap";

const eightWeekSeason: Season = { lengthWeeks: 8, startWeekday: 0 }; // 56 days, cap = 28

describe("seasonPauseCap (D9)", () => {
  it("is exactly 50% of the season length in natural days", () => {
    expect(seasonPauseCap(eightWeekSeason)).toBe(28);
    expect(seasonPauseCap({ lengthWeeks: 4, startWeekday: 0 })).toBe(14);
    expect(seasonPauseCap({ lengthWeeks: 6, startWeekday: 0 })).toBe(21);
    expect(seasonPauseCap({ lengthWeeks: 12, startWeekday: 0 })).toBe(42);
  });
});

describe("canRequestPause (D9)", () => {
  it("E12: a 28-day request against a fresh 56-day season is allowed (max = 28 days)", () => {
    const result = canRequestPause(
      eightWeekSeason,
      [],
      { startDay: seasonDay(0), end: { kind: "fixed", lastDay: seasonDay(27) } },
      seasonDay(0),
    );
    expect(result).toEqual({ allowed: true, remainingDays: 0 });
  });

  it("E13: already 28 days paused, one more day is not allowed (cap exhausted)", () => {
    const history = [
      buildPauseRequest(
        "leer",
        0,
        { kind: "fixed", lastDay: seasonDay(27) },
        { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
      ),
    ];
    const result = canRequestPause(
      eightWeekSeason,
      history,
      { startDay: seasonDay(30), end: { kind: "fixed", lastDay: seasonDay(30) } },
      seasonDay(30),
    );
    expect(result).toEqual({ allowed: false, reason: "capExhausted" });
  });

  it("E14: 20 days already paused, a fixed 10-day request is disallowed (only 8 remain)", () => {
    const history = [
      buildPauseRequest(
        "leer",
        0,
        { kind: "fixed", lastDay: seasonDay(19) },
        { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
      ),
    ];
    const result = canRequestPause(
      eightWeekSeason,
      history,
      { startDay: seasonDay(30), end: { kind: "fixed", lastDay: seasonDay(39) } },
      seasonDay(30),
    );
    expect(result).toEqual({ allowed: false, reason: "exceedsRemainingCap" });
  });

  it("E16: a request starting before today is rejected as retroactive", () => {
    const result = canRequestPause(
      eightWeekSeason,
      [],
      { startDay: seasonDay(9), end: { kind: "open" } },
      seasonDay(10),
    );
    expect(result).toEqual({ allowed: false, reason: "retroactive" });
  });

  it("E22: early resume consumes only the days actually paused (20-24 = 5 days, not the full 20-33 range)", () => {
    const history = [
      buildPauseRequest(
        "gym",
        20,
        { kind: "fixed", lastDay: seasonDay(33) },
        { kind: "approved", decidedOn: seasonDay(20), resumedOn: seasonDay(25) },
      ),
    ];
    // remaining = 28 - 5 = 23: a fixed 23-day request exactly exhausts it.
    const result = canRequestPause(
      eightWeekSeason,
      history,
      { startDay: seasonDay(40), end: { kind: "fixed", lastDay: seasonDay(62) } },
      seasonDay(40),
    );
    expect(result).toEqual({ allowed: true, remainingDays: 0 });
  });

  it("R4b: pending request days count toward the cap exactly like approved ones", () => {
    const history = [
      buildPauseRequest(
        "leer",
        0,
        { kind: "fixed", lastDay: seasonDay(13) },
        { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
      ),
      buildPauseRequest("leer", 14, { kind: "fixed", lastDay: seasonDay(27) }, { kind: "pending" }),
    ];
    // 14 approved + 14 pending = 28 already used -> cap exhausted, even though only 14 are "approved".
    const result = canRequestPause(
      eightWeekSeason,
      history,
      { startDay: seasonDay(30), end: { kind: "fixed", lastDay: seasonDay(30) } },
      seasonDay(30),
    );
    expect(result).toEqual({ allowed: false, reason: "capExhausted" });
  });

  it("an open-ended request within the remaining allowance is allowed, reporting the remaining days", () => {
    const result = canRequestPause(
      eightWeekSeason,
      [],
      { startDay: seasonDay(0), end: { kind: "open" } },
      seasonDay(0),
    );
    expect(result).toEqual({ allowed: true, remainingDays: 28 });
  });
});
