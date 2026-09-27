import { describe, expect, it } from "vitest";
import { seasonDay } from "../calendar/season-calendar";
import { buildPauseRequest } from "../test-support/builders";
import { effectivePausedDays, pendingHoldDays } from "./pause";

describe("effectivePausedDays", () => {
  it("covers a fixed-end approved pause, start through lastDay inclusive", () => {
    const pauses = [
      buildPauseRequest(
        "leer",
        14,
        { kind: "fixed", lastDay: seasonDay(27) },
        {
          kind: "approved",
          decidedOn: seasonDay(14),
          resumedOn: null,
        },
      ),
    ];
    const days = effectivePausedDays(pauses, seasonDay(40));
    expect(days.size).toBe(14);
    expect(days.has(seasonDay(14))).toBe(true);
    expect(days.has(seasonDay(27))).toBe(true);
    expect(days.has(seasonDay(28))).toBe(false);
  });

  it("covers an open approved pause through today when never resumed", () => {
    const pauses = [
      buildPauseRequest(
        "gym",
        10,
        { kind: "open" },
        {
          kind: "approved",
          decidedOn: seasonDay(10),
          resumedOn: null,
        },
      ),
    ];
    const days = effectivePausedDays(pauses, seasonDay(15));
    expect(days.size).toBe(6); // days 10..15
    expect(days.has(seasonDay(15))).toBe(true);
    expect(days.has(seasonDay(16))).toBe(false);
  });

  it("stops at an early resume, even for a fixed-end pause (E22 math: 20-33 resumed day 25 -> 5 days)", () => {
    const pauses = [
      buildPauseRequest(
        "gym",
        20,
        { kind: "fixed", lastDay: seasonDay(33) },
        {
          kind: "approved",
          decidedOn: seasonDay(20),
          resumedOn: seasonDay(25),
        },
      ),
    ];
    const days = effectivePausedDays(pauses, seasonDay(60));
    expect(days.size).toBe(5); // 20,21,22,23,24
    expect(days.has(seasonDay(24))).toBe(true);
    expect(days.has(seasonDay(25))).toBe(false);
  });

  it("pauses from the request date, not the decision date (E17)", () => {
    const pauses = [
      buildPauseRequest(
        "leer",
        10,
        { kind: "open" },
        {
          kind: "approved",
          decidedOn: seasonDay(11),
          resumedOn: null,
        },
      ),
    ];
    const days = effectivePausedDays(pauses, seasonDay(11));
    expect(days.has(seasonDay(10))).toBe(true);
  });

  it("contributes no days for a rejected request (E18/E20)", () => {
    const pauses = [
      buildPauseRequest(
        "leer",
        10,
        { kind: "open" },
        { kind: "rejected", decidedOn: seasonDay(12) },
      ),
    ];
    expect(effectivePausedDays(pauses, seasonDay(20)).size).toBe(0);
  });

  it("contributes no days for a still-pending request", () => {
    const pauses = [buildPauseRequest("leer", 10, { kind: "open" }, { kind: "pending" })];
    expect(effectivePausedDays(pauses, seasonDay(20)).size).toBe(0);
  });

  it("does not throw when resumed on day 0 (resumedOn - 1 would be negative) — 0 days paused", () => {
    const pauses = [
      buildPauseRequest(
        "gym",
        0,
        { kind: "open" },
        {
          kind: "approved",
          decidedOn: seasonDay(0),
          resumedOn: seasonDay(0),
        },
      ),
    ];
    expect(() => effectivePausedDays(pauses, seasonDay(20))).not.toThrow();
    expect(effectivePausedDays(pauses, seasonDay(20)).size).toBe(0);
  });
});

describe("pendingHoldDays (R4a)", () => {
  it("covers a pending request's days up to today", () => {
    const pauses = [buildPauseRequest("leer", 10, { kind: "open" }, { kind: "pending" })];
    const days = pendingHoldDays(pauses, seasonDay(13));
    expect(days.size).toBe(4); // 10,11,12,13
  });

  it("contributes no days once approved or rejected — the decision resolves the hold", () => {
    const approved = [
      buildPauseRequest(
        "leer",
        10,
        { kind: "open" },
        {
          kind: "approved",
          decidedOn: seasonDay(11),
          resumedOn: null,
        },
      ),
    ];
    const rejected = [
      buildPauseRequest(
        "leer",
        10,
        { kind: "open" },
        { kind: "rejected", decidedOn: seasonDay(11) },
      ),
    ];
    expect(pendingHoldDays(approved, seasonDay(20)).size).toBe(0);
    expect(pendingHoldDays(rejected, seasonDay(20)).size).toBe(0);
  });
});

// R4a's "recompute on decision" is now proven end-to-end, from real pause/entry data,
// through `pauseAwareWeekSessions` — see `pause-aware-week.test.ts`.
