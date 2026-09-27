import { describe, expect, it } from "vitest";
import { fromInt } from "../fraction/fraction";
import type { SessionResult } from "../opportunity/per-session";
import { computeStreak, dayStreakOutcome, weekStreakOutcome } from "./streak";

const kept: SessionResult = { value: null, progress: fromInt(1), consistent: true };
const missed: SessionResult = { value: null, progress: fromInt(0), consistent: false };

describe("computeStreak (D11)", () => {
  it("extends current and tracks best while every outcome is kept", () => {
    expect(computeStreak("week", ["kept", "kept", "kept"])).toEqual({
      unit: "week",
      current: 3,
      best: 3,
    });
  });

  it("resets current to zero on a broken outcome, without touching best", () => {
    expect(computeStreak("week", ["kept", "kept", "broken"])).toEqual({
      unit: "week",
      current: 0,
      best: 2,
    });
  });

  it("freezes current across a paused/on-hold gap — neither breaks nor extends it (Mecanicas: 'la pausa congela la racha')", () => {
    expect(computeStreak("week", ["kept", "kept", "frozen", "frozen", "kept"])).toEqual({
      unit: "week",
      current: 3,
      best: 3,
    });
  });

  it("preserves the best streak independently of a later reset", () => {
    expect(computeStreak("day", ["kept", "kept", "kept", "kept", "kept", "broken"])).toEqual({
      unit: "day",
      current: 0,
      best: 5,
    });
  });

  it("returns zero/zero for an empty sequence", () => {
    expect(computeStreak("week", [])).toEqual({ unit: "week", current: 0, best: 0 });
  });
});

describe("weekStreakOutcome (D11: a timesPerWeek/weeklyTotal week maintains the streak only if every session reached the minimum)", () => {
  it("is 'kept' when every session of the week is consistent", () => {
    expect(weekStreakOutcome(false, [kept, kept, kept])).toBe("kept");
  });

  it("is 'broken' when at least one session of the week is not consistent", () => {
    expect(weekStreakOutcome(false, [kept, kept, missed])).toBe("broken");
  });

  it("is 'frozen' when the week is paused/on-hold, regardless of its sessions", () => {
    expect(weekStreakOutcome(true, [kept, kept, kept])).toBe("frozen");
  });
});

describe("dayStreakOutcome (D11: a specificDays day's own outcome)", () => {
  it("is 'kept' when the day's session is consistent", () => {
    expect(dayStreakOutcome(false, kept)).toBe("kept");
  });

  it("is 'broken' when the day's session is not consistent", () => {
    expect(dayStreakOutcome(false, missed)).toBe("broken");
  });

  it("is 'frozen' when the day is paused/on-hold, regardless of its session", () => {
    expect(dayStreakOutcome(true, kept)).toBe("frozen");
  });
});
