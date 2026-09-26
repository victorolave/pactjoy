import { describe, expect, it } from "vitest";
import type { Season } from "../calendar/season-calendar";
import { seasonDay } from "../calendar/season-calendar";
import { graceDeadline, isOnTime } from "../entry/grace-period";
import { fromInt } from "../fraction/fraction";
import {
  buildDoneEntry,
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders";
import { fr } from "../test-support/fraction-literal";
import { pauseAwareWeekSessions } from "./pause-aware-week";

const inglesTarget = { direction: "reach" as const, minimum: fromInt(60), ideal: fromInt(150) };

describe("pauseAwareWeekSessions — no pauses (baseline, delegates to the existing dispatcher unchanged)", () => {
  it("timesPerWeek: scores exactly like the plain dispatcher when nothing is paused", () => {
    const gym = buildQuantityCommitment(
      "gym",
      30,
      "times",
      { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
      {
        kind: "timesPerWeek",
        times: 3,
      },
    );
    const entries = [buildDoneEntry("gym", 0), buildDoneEntry("gym", 1), buildDoneEntry("gym", 2)];
    const result = pauseAwareWeekSessions(gym, 0, [], entries, seasonDay(6));
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions.map((s) => s.progress)).toEqual([fr("1"), fr("1"), fr("1")]);
  });

  it("weeklyTotal: scores exactly like the plain dispatcher when nothing is paused", () => {
    const ingles = buildWeeklyTotalCommitment("ingles", 25, "minutes", inglesTarget);
    const entries = [buildQuantityEntry("ingles", 0, fromInt(150))];
    const result = pauseAwareWeekSessions(ingles, 0, [], entries, seasonDay(6));
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions[0]?.progress).toEqual(fr("1"));
  });
});

describe("pauseAwareWeekSessions — D6/D7 proration closes the week", () => {
  it("timesPerWeek: 1 active day out of 7 prorates N to 0 -> status 'paused'", () => {
    const gym = buildQuantityCommitment(
      "gym",
      30,
      "times",
      { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
      {
        kind: "timesPerWeek",
        times: 3,
      },
    );
    const pauses = [
      buildPauseRequest(
        "gym",
        0,
        { kind: "fixed", lastDay: seasonDay(5) },
        {
          kind: "approved",
          decidedOn: seasonDay(0),
          resumedOn: null,
        },
      ),
    ];
    const result = pauseAwareWeekSessions(gym, 0, pauses, [], seasonDay(10));
    expect(result.status).toBe("paused");
  });

  it("weeklyTotal: proration to 0 also closes the week (D7's governing-figure rule)", () => {
    const ingles = buildWeeklyTotalCommitment("ingles", 25, "minutes", inglesTarget);
    const pauses = [
      // the whole week (0 active days) -> ideal prorates to round(0)=0, the governing figure for reach
      buildPauseRequest(
        "ingles",
        0,
        { kind: "fixed", lastDay: seasonDay(6) },
        {
          kind: "approved",
          decidedOn: seasonDay(0),
          resumedOn: null,
        },
      ),
    ];
    const result = pauseAwareWeekSessions(ingles, 0, pauses, [], seasonDay(10));
    expect(result.status).toBe("paused");
  });
});

describe("pauseAwareWeekSessions — D8: a session on a paused day is discarded, the week still scores", () => {
  it("an entry recorded on a paused day never reaches the underlying dispatcher", () => {
    const gym = buildQuantityCommitment(
      "gym",
      30,
      "times",
      { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
      {
        kind: "timesPerWeek",
        times: 3,
      },
    );
    // days 3,4,5 paused -> 4 active days -> prorated N = round(3*4/7) = 2
    const pauses = [
      buildPauseRequest(
        "gym",
        3,
        { kind: "fixed", lastDay: seasonDay(5) },
        {
          kind: "approved",
          decidedOn: seasonDay(3),
          resumedOn: null,
        },
      ),
    ];
    const entries = [buildDoneEntry("gym", 0), buildDoneEntry("gym", 4)]; // day 4 is paused
    const result = pauseAwareWeekSessions(gym, 0, pauses, entries, seasonDay(6));
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions.map((s) => s.progress)).toEqual([fr("1"), fr("0")]);
  });
});

describe("pauseAwareWeekSessions — R4a: pending excludes, decision recomputes by a fresh call", () => {
  it("a pending request covering the whole week -> status 'onHold' (excluded, not 'paused')", () => {
    const gym = buildQuantityCommitment(
      "gym",
      30,
      "times",
      { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
      {
        kind: "timesPerWeek",
        times: 3,
      },
    );
    const pauses = [
      buildPauseRequest("gym", 0, { kind: "fixed", lastDay: seasonDay(6) }, { kind: "pending" }),
    ];
    const result = pauseAwareWeekSessions(gym, 0, pauses, [], seasonDay(6));
    expect(result.status).toBe("onHold");
  });

  it("the SAME request, once rejected, recomputes to a normal scored week — a fresh call, no special recompute code", () => {
    const gym = buildQuantityCommitment(
      "gym",
      30,
      "times",
      { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
      {
        kind: "timesPerWeek",
        times: 3,
      },
    );
    const rejected = [
      buildPauseRequest(
        "gym",
        0,
        { kind: "fixed", lastDay: seasonDay(6) },
        {
          kind: "rejected",
          decidedOn: seasonDay(6),
        },
      ),
    ];
    const entries = [buildDoneEntry("gym", 0), buildDoneEntry("gym", 1), buildDoneEntry("gym", 2)];
    const result = pauseAwareWeekSessions(gym, 0, rejected, entries, seasonDay(6));
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions.map((s) => s.progress)).toEqual([fr("1"), fr("1"), fr("1")]);
  });
});

describe("pauseAwareWeekSessions — a rejection extends grace for its affected opportunities", () => {
  it("timesPerWeek: a late entry within the extended (post-rejection) deadline now counts", () => {
    const gym = buildQuantityCommitment(
      "gym",
      30,
      "times",
      { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
      {
        kind: "timesPerWeek",
        times: 3,
      },
    );
    // request covering day 0, rejected on day 5 -> day 0's own deadline (normally day 1) extends to day 6.
    const rejected = [
      buildPauseRequest(
        "gym",
        0,
        { kind: "fixed", lastDay: seasonDay(0) },
        {
          kind: "rejected",
          decidedOn: seasonDay(5),
        },
      ),
    ];
    const entries = [
      buildDoneEntry("gym", 0, seasonDay(6)), // recorded day 6 — late under the normal day-1 deadline
      buildDoneEntry("gym", 1),
      buildDoneEntry("gym", 2),
    ];
    const result = pauseAwareWeekSessions(gym, 0, rejected, entries, seasonDay(6));
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions.map((s) => s.progress)).toEqual([fr("1"), fr("1"), fr("1")]);
  });

  it("triangulation: without a rejection covering that day, the same late entry does NOT count", () => {
    const gym = buildQuantityCommitment(
      "gym",
      30,
      "times",
      { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
      {
        kind: "timesPerWeek",
        times: 3,
      },
    );
    const entries = [
      buildDoneEntry("gym", 0, seasonDay(6)), // still late, no extension applies
      buildDoneEntry("gym", 1),
      buildDoneEntry("gym", 2),
    ];
    const result = pauseAwareWeekSessions(gym, 0, [], entries, seasonDay(6));
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    // day 0's entry is discarded (late) -> only 2 real sessions + 1 empty slot, best-2 sort puts the empty last
    expect(result.sessions.map((s) => s.progress)).toEqual([fr("1"), fr("1"), fr("0")]);
  });

  it("weeklyTotal: the week's shared deadline extends when a rejection overlaps the week", () => {
    const ingles = buildWeeklyTotalCommitment("ingles", 25, "minutes", inglesTarget);
    // request covering day 2 (inside week 0), rejected on day 20 -> week 0's deadline (normally day 7) extends to day 21.
    const rejected = [
      buildPauseRequest(
        "ingles",
        2,
        { kind: "fixed", lastDay: seasonDay(2) },
        {
          kind: "rejected",
          decidedOn: seasonDay(20),
        },
      ),
    ];
    const entries = [buildQuantityEntry("ingles", 0, fromInt(150), seasonDay(15))]; // normally late (deadline 7), now within 21
    const result = pauseAwareWeekSessions(ingles, 0, rejected, entries, seasonDay(20));
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions[0]?.progress).toEqual(fr("1"));
  });

  it("never rewrites recordedOn to fake grace — the same entry still fails the plain, unextended check afterward", () => {
    const gym = buildQuantityCommitment(
      "gym",
      30,
      "times",
      { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
      { kind: "timesPerWeek", times: 3 },
    );
    const rejected = [
      buildPauseRequest(
        "gym",
        0,
        { kind: "fixed", lastDay: seasonDay(0) },
        { kind: "rejected", decidedOn: seasonDay(5) },
      ),
    ];
    const lateEntry = buildDoneEntry("gym", 0, seasonDay(6)); // day 0, normal deadline is day 1
    const entries = [lateEntry, buildDoneEntry("gym", 1), buildDoneEntry("gym", 2)];
    const result = pauseAwareWeekSessions(gym, 0, rejected, entries, seasonDay(6));
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions.map((s) => s.progress)).toEqual([fr("1"), fr("1"), fr("1")]); // extension worked
    // ...yet the SAME object, checked against the plain unextended deadline, is still genuinely late —
    // proving the extension happened via a deadline override, not by rewriting the entry itself.
    expect(lateEntry.recordedOn).toBe(seasonDay(6));
    expect(isOnTime(lateEntry, graceDeadline(lateEntry.day))).toBe(false);
  });
});

describe("pauseAwareWeekSessions — specificDays", () => {
  const monday: Season = { lengthWeeks: 4, startWeekday: 0 };
  const dibujar = buildQuantityCommitment(
    "dibujar",
    20,
    "times",
    { direction: "reach", minimum: fromInt(1), ideal: fromInt(1) },
    { kind: "specificDays", weekdays: [1, 3, 5] },
  );

  it("delegates straight to specificDaysSessions when the week has no active pause or on-hold request (no crash — slice 6a needs this)", () => {
    const entries = [
      buildDoneEntry("dibujar", 1),
      buildDoneEntry("dibujar", 3),
      buildDoneEntry("dibujar", 5),
    ];
    const result = pauseAwareWeekSessions(dibujar, 0, [], entries, seasonDay(6), monday);
    expect(result.status).toBe("scored");
    if (result.status !== "scored") throw new Error("unreachable");
    expect(result.sessions.map((s) => s.progress)).toEqual([fr("1"), fr("1"), fr("1")]);
  });

  it("still throws — as a pending product decision, not a silent guess — when the week touches an active pause", () => {
    const pauses = [
      buildPauseRequest(
        "dibujar",
        0,
        { kind: "fixed", lastDay: seasonDay(1) },
        { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
      ),
    ];
    expect(() => pauseAwareWeekSessions(dibujar, 0, pauses, [], seasonDay(6), monday)).toThrow(
      RangeError,
    );
  });

  it("still throws when the week touches a still-pending (on-hold) request", () => {
    const pauses = [
      buildPauseRequest(
        "dibujar",
        5,
        { kind: "fixed", lastDay: seasonDay(6) },
        { kind: "pending" },
      ),
    ];
    expect(() => pauseAwareWeekSessions(dibujar, 0, pauses, [], seasonDay(6), monday)).toThrow(
      RangeError,
    );
  });

  it("throws a distinct error when season is omitted but specificDays actually needs it", () => {
    expect(() => pauseAwareWeekSessions(dibujar, 0, [], [], seasonDay(6))).toThrow(RangeError);
  });
});
