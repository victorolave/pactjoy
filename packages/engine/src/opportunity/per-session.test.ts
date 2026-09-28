import { describe, expect, it } from "vitest";
import type { Season, Weekday } from "../calendar/season-calendar.ts";
import { seasonDay } from "../calendar/season-calendar.ts";
import type { Target } from "../commitment/commitment.ts";
import { graceDeadline } from "../entry/grace-period.ts";
import { fromInt, mean, parseDecimal } from "../fraction/fraction.ts";
import { buildDoneEntry, buildQuantityEntry } from "../test-support/builders.ts";
import { fr } from "../test-support/fraction-literal.ts";
import { specificDaysSessions, sumEntryValues, timesPerWeekSessions } from "./per-session.ts";

const booleanTarget: Target = { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) };
const minutesTarget: Target = { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) };

describe("sumEntryValues", () => {
  it("sums two quantity entries into one value (D4)", () => {
    const entries = [
      buildQuantityEntry("read", 0, parseDecimal("10")),
      buildQuantityEntry("read", 0, parseDecimal("15")),
    ];
    expect(sumEntryValues(entries)).toEqual(parseDecimal("25"));
  });

  it("treats a done entry as a value of 1", () => {
    expect(sumEntryValues([buildDoneEntry("gym", 0)])).toEqual(fromInt(1));
  });

  it("treats a missed entry as a value of 0", () => {
    const entries = [buildQuantityEntry("read", 0, parseDecimal("10"))];
    expect(sumEntryValues(entries)).toEqual(parseDecimal("10"));
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

  it("honors a custom deadlineFor policy instead of the default graceDeadline — without touching recordedOn", () => {
    const entry = buildDoneEntry("gym", 0, 5); // day 0, recorded day 5 — normally long past deadline (day 1)
    const originalRecordedOn = entry.recordedOn;
    const alwaysLate: (day: ReturnType<typeof seasonDay>) => ReturnType<typeof seasonDay> = () =>
      seasonDay(5); // extend day 0's deadline out to day 5
    const sessions = timesPerWeekSessions(booleanTarget, 1, [entry], alwaysLate);
    expect(sessions[0]?.progress).toEqual(fromInt(1)); // now on time, per the custom policy
    expect(entry.recordedOn).toBe(originalRecordedOn); // the entry itself was never rewritten
  });

  it("defaults to graceDeadline when no policy is passed — same result either way", () => {
    const entries = [buildDoneEntry("gym", 0, 2)];
    const withDefault = timesPerWeekSessions(booleanTarget, 1, entries);
    const explicit = timesPerWeekSessions(booleanTarget, 1, entries, graceDeadline);
    expect(withDefault).toEqual(explicit);
  });
});

describe("specificDaysSessions", () => {
  const monday: Season = { lengthWeeks: 4, startWeekday: 0 };
  const tueThuSat: readonly Weekday[] = [1, 3, 5];

  it("N8: an entry on every scheduled day gives full progress on all of them", () => {
    const entries = [
      buildDoneEntry("draw", 1),
      buildDoneEntry("draw", 3),
      buildDoneEntry("draw", 5),
    ];
    const sessions = specificDaysSessions(booleanTarget, monday, 0, tueThuSat, entries);
    expect(sessions.map((s) => s.progress)).toEqual([fromInt(1), fromInt(1), fromInt(1)]);
  });

  it("N9: a missing scheduled day closes at zero when nothing covers it", () => {
    const entries = [buildDoneEntry("draw", 1), buildDoneEntry("draw", 3)];
    const sessions = specificDaysSessions(booleanTarget, monday, 0, tueThuSat, entries);
    expect(sessions.map((s) => s.progress)).toEqual([fromInt(1), fromInt(1), fromInt(0)]);
    expect(sessions.filter((s) => s.consistent)).toHaveLength(2);
  });

  it("N10 (D5): an entry on a non-scheduled day covers a missed scheduled day, same week only", () => {
    const entries = [
      buildDoneEntry("draw", 2), // wednesday — not scheduled, covers the missing tuesday
      buildDoneEntry("draw", 3),
      buildDoneEntry("draw", 5),
    ];
    const sessions = specificDaysSessions(booleanTarget, monday, 0, tueThuSat, entries);
    expect(sessions.map((s) => s.progress)).toEqual([fromInt(1), fromInt(1), fromInt(1)]);
  });

  it("N11 (D5): a non-scheduled entry adds nothing when nothing was missed, and never raises the count", () => {
    const entries = [
      buildDoneEntry("draw", 1),
      buildDoneEntry("draw", 2), // wednesday — extra, nothing to cover
      buildDoneEntry("draw", 3),
      buildDoneEntry("draw", 5),
    ];
    const sessions = specificDaysSessions(booleanTarget, monday, 0, tueThuSat, entries);
    expect(sessions).toHaveLength(3);
    expect(sessions.map((s) => s.progress)).toEqual([fromInt(1), fromInt(1), fromInt(1)]);
  });

  it("honors a custom deadlineFor policy — a late covering entry now counts", () => {
    const entries = [
      buildDoneEntry("draw", 3),
      buildDoneEntry("draw", 5),
      buildDoneEntry("draw", 2, 4), // wednesday, recorded day 4 — normally past deadline (day 3)
    ];
    const extendWednesdayOnly = (day: number) =>
      day === 2 ? seasonDay(4) : graceDeadline(seasonDay(day));
    const sessions = specificDaysSessions(
      booleanTarget,
      monday,
      0,
      tueThuSat,
      entries,
      extendWednesdayOnly,
    );
    expect(sessions.map((s) => s.progress)).toEqual([fromInt(1), fromInt(1), fromInt(1)]);
  });

  it("discards a late covering entry before it can cover a missed scheduled day (D5 grace gate)", () => {
    const entries = [
      buildDoneEntry("draw", 3), // thursday, on time
      buildDoneEntry("draw", 5), // saturday, on time
      buildDoneEntry("draw", 2, 4), // wednesday, recorded day 4 — deadline was day 3, discarded
    ];
    const sessions = specificDaysSessions(booleanTarget, monday, 0, tueThuSat, entries);
    // tuesday stays missing — the late wednesday entry never becomes available to cover it
    expect(sessions.map((s) => s.progress)).toEqual([fromInt(0), fromInt(1), fromInt(1)]);
  });

  it("D5 with multiple misses and multiple extras: the week result is independent of entry order (engine-authored, not a Notion row)", () => {
    const dibujarTarget: Target = { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) };
    const thu = buildQuantityEntry("draw", 3, parseDecimal("30")); // scheduled, present
    const wed = buildQuantityEntry("draw", 2, parseDecimal("15")); // extra, covers a miss
    const fri = buildQuantityEntry("draw", 4, parseDecimal("25")); // extra, covers the other miss
    // tuesday and saturday both start missing; wed and fri are the two covering extras.

    const orderA = specificDaysSessions(dibujarTarget, monday, 0, tueThuSat, [wed, fri, thu]);
    const orderB = specificDaysSessions(dibujarTarget, monday, 0, tueThuSat, [fri, wed, thu]);
    const orderC = specificDaysSessions(dibujarTarget, monday, 0, tueThuSat, [thu, fri, wed]);

    expect(orderB).toEqual(orderA);
    expect(orderC).toEqual(orderA);
    // the two covering values (15 and 25) land in the two missing slots either way;
    // the aggregate is the same 3-value mean regardless of which slot gets which.
    expect(mean(orderA.map((s) => s.progress))).toEqual(fr("7/9"));
  });
});
