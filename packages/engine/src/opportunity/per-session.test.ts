import { describe, expect, it } from "vitest";
import type { Target } from "../commitment/commitment";
import { fromInt, parseDecimal } from "../fraction/fraction";
import { buildDoneEntry, buildQuantityEntry } from "../test-support/builders";
import { sumSameDayEntries, timesPerWeekSessions } from "./per-session";

const booleanTarget: Target = { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) };
const minutesTarget: Target = { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) };

describe("sumSameDayEntries", () => {
  it("sums two quantity entries into one value (D4)", () => {
    const entries = [
      buildQuantityEntry("read", 0, parseDecimal("10")),
      buildQuantityEntry("read", 0, parseDecimal("15")),
    ];
    expect(sumSameDayEntries(entries)).toEqual(parseDecimal("25"));
  });

  it("treats a done entry as a value of 1", () => {
    expect(sumSameDayEntries([buildDoneEntry("gym", 0)])).toEqual(fromInt(1));
  });

  it("treats a missed entry as a value of 0", () => {
    const entries = [buildQuantityEntry("read", 0, parseDecimal("10"))];
    expect(sumSameDayEntries(entries)).toEqual(parseDecimal("10"));
  });
});

describe("timesPerWeekSessions", () => {
  it("N1: fewer sessions than N slots, each on a free day, all consistent", () => {
    const entries = [buildDoneEntry("gym", 0), buildDoneEntry("gym", 1), buildDoneEntry("gym", 2)];
    const sessions = timesPerWeekSessions(booleanTarget, 3, entries);
    expect(sessions.map((s) => s.progress)).toEqual([fromInt(1), fromInt(1), fromInt(1)]);
    expect(sessions.every((s) => s.consistent)).toBe(true);
  });

  it("N2: more sessions than N slots — extra sessions are dropped, never duplicated", () => {
    const entries = [0, 1, 2, 3, 4, 5].map((day) => buildDoneEntry("gym", day));
    const sessions = timesPerWeekSessions(booleanTarget, 3, entries);
    expect(sessions).toHaveLength(3);
    expect(sessions.every((s) => s.progress.num === 1n && s.progress.den === 1n)).toBe(true);
  });

  it("N3: fewer sessions than N slots — the missing slot closes at zero", () => {
    const entries = [buildDoneEntry("gym", 0), buildDoneEntry("gym", 1)];
    const sessions = timesPerWeekSessions(booleanTarget, 3, entries);
    expect(sessions.map((s) => s.progress)).toEqual([fromInt(1), fromInt(1), fromInt(0)]);
    expect(sessions.filter((s) => s.consistent)).toHaveLength(2);
  });

  it("N4: no entries — every slot closes at zero", () => {
    const sessions = timesPerWeekSessions(booleanTarget, 3, []);
    expect(sessions).toEqual([
      { value: null, progress: fromInt(0), consistent: false },
      { value: null, progress: fromInt(0), consistent: false },
      { value: null, progress: fromInt(0), consistent: false },
    ]);
  });

  it("N6: best 5 of 7 sessions count, in descending order", () => {
    const minutes = [30, 30, 30, 20, 10, 5, 30];
    const entries = minutes.map((m, day) =>
      buildQuantityEntry("read", day, parseDecimal(String(m))),
    );
    const sessions = timesPerWeekSessions(minutesTarget, 5, entries);
    expect(sessions.map((s) => s.progress)).toEqual([
      fromInt(1),
      fromInt(1),
      fromInt(1),
      fromInt(1),
      { num: 2n, den: 3n },
    ]);
  });

  it("N7: same-day entries sum into one session, occupying only one of N slots", () => {
    const entries = [
      buildQuantityEntry("read", 0, parseDecimal("10")),
      buildQuantityEntry("read", 0, parseDecimal("20")),
    ];
    const sessions = timesPerWeekSessions(minutesTarget, 5, entries);
    expect(sessions).toHaveLength(5);
    expect(sessions.filter((s) => s.consistent)).toHaveLength(1);
    expect(sessions[0]?.progress).toEqual(fromInt(1));
    expect(sessions[0]?.value).toEqual(parseDecimal("30"));
  });

  it("discards a late entry: recorded after its own opportunity's grace deadline (D4 grace gate)", () => {
    const entries = [buildDoneEntry("gym", 0, 2)]; // day 0, recorded day 2 — deadline is day 1
    const sessions = timesPerWeekSessions(booleanTarget, 1, entries);
    expect(sessions[0]?.progress).toEqual(fromInt(0));
    expect(sessions[0]?.consistent).toBe(false);
  });

  it("counts an on-time entry recorded on the last day of grace", () => {
    const entries = [buildDoneEntry("gym", 0, 1)]; // day 0, recorded day 1 — exactly the deadline
    const sessions = timesPerWeekSessions(booleanTarget, 1, entries);
    expect(sessions[0]?.progress).toEqual(fromInt(1));
    expect(sessions[0]?.consistent).toBe(true);
  });
});
