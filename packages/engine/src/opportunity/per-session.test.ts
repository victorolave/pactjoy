import { describe, expect, it } from "vitest";
import type { Season, Weekday } from "../calendar/season-calendar.ts";
import { seasonDay } from "../calendar/season-calendar.ts";
import type { Target } from "../commitment/commitment.ts";
import { graceDeadline } from "../entry/grace-period.ts";
import { fromInt, mean, parseDecimal } from "../fraction/fraction.ts";
import { buildDoneEntry, buildQuantityEntry } from "../test-support/builders.ts";
import { fr } from "../test-support/fraction-literal.ts";
import {
  specificDaysSessions,
  sumEntryValues,
  timesPerWeekAssignments,
  timesPerWeekSessions,
} from "./per-session.ts";

const booleanTarget: Target = { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) };
const minutesTarget: Target = { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) };

describe("timesPerWeekAssignments", () => {
  it("retains the best-N source days after same-day sums; tied scores keep existing input order", () => {
    const entries = [
      buildQuantityEntry("read", 2, fromInt(15)),
      buildQuantityEntry("read", 0, fromInt(30)),
      buildQuantityEntry("read", 2, fromInt(15)),
      buildQuantityEntry("read", 1, fromInt(10)),
    ];
    const assignments = timesPerWeekAssignments(minutesTarget, 2, entries);
    expect(assignments.map((a) => a.sourceDay)).toEqual([2, 0]);
    expect(assignments.map((a) => a.session.value)).toEqual([fromInt(30), fromInt(30)]);
    expect(assignments.map((a) => a.session)).toEqual(
      timesPerWeekSessions(minutesTarget, 2, entries),
    );
  });

  it("leaves synthetic empty slots without source days and rejects entries after grace", () => {
    const late = buildDoneEntry("gym", 2, 8);
    const entries = [buildDoneEntry("gym", 1), late];
    const assignments = timesPerWeekAssignments(booleanTarget, 3, entries);
    expect(assignments.map((a) => a.sourceDay)).toEqual([1, null, null]);
    expect(assignments.map((a) => a.session.value)).toEqual([fromInt(1), null, null]);
    expect(
      timesPerWeekAssignments(booleanTarget, 1, [late], () => seasonDay(8)).map((a) => a.sourceDay),
    ).toEqual([2]);
  });
});

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

  it("Q16: counts a session recorded after its own day's grace, within the week's close plus grace", () => {
    const entries = [buildDoneEntry("gym", 1, 5)]; // day 1, recorded day 5 — week closes day 6, deadline day 7
    const sessions = timesPerWeekSessions(booleanTarget, 1, entries);
    expect(sessions[0]?.progress).toEqual(fromInt(1));
    expect(sessions[0]?.consistent).toBe(true);
  });

  it("Q16: counts a session recorded on the last day of the week's grace (day 7)", () => {
    const entries = [buildDoneEntry("gym", 0, 7)];
    const sessions = timesPerWeekSessions(booleanTarget, 1, entries);
    expect(sessions[0]?.progress).toEqual(fromInt(1));
  });

  it("Q16: discards a session recorded after the week's close plus grace (day 8)", () => {
    const entries = [buildDoneEntry("gym", 0, 8)];
    const sessions = timesPerWeekSessions(booleanTarget, 1, entries);
    expect(sessions[0]?.progress).toEqual(fromInt(0));
    expect(sessions[0]?.consistent).toBe(false);
  });

  it("Q16: the week window is the entry's own week (week 1 closes on day 13)", () => {
    expect(
      timesPerWeekSessions(booleanTarget, 1, [buildDoneEntry("gym", 8, 14)])[0]?.progress,
    ).toEqual(fromInt(1));
    expect(
      timesPerWeekSessions(booleanTarget, 1, [buildDoneEntry("gym", 8, 15)])[0]?.progress,
    ).toEqual(fromInt(0));
  });

  it("honors a custom deadlineFor policy, receiving the week's end day — without touching recordedOn", () => {
    const entry = buildDoneEntry("gym", 0, 9); // normally past the week's deadline (day 7)
    const originalRecordedOn = entry.recordedOn;
    const received: number[] = [];
    const extended: (day: ReturnType<typeof seasonDay>) => ReturnType<typeof seasonDay> = (end) => {
      received.push(end);
      return seasonDay(9);
    };
    const sessions = timesPerWeekSessions(booleanTarget, 1, [entry], extended);
    expect(received).toEqual([6]);
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
