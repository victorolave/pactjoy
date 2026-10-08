import { describe, expect, it } from "vitest";
import { seasonDay } from "../calendar/season-calendar.ts";
import { fromInt } from "../fraction/fraction.ts";
import {
  buildDoneCommitment,
  buildDoneEntry,
  buildMissedEntry,
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders.ts";
import { fr } from "../test-support/fraction-literal.ts";
import { historyProvenance } from "./history-provenance.ts";
import { type ScoreInput, scoreMember, seasonSessions } from "./member-score.ts";

const daily = buildDoneCommitment("daily", 100, { kind: "specificDays", weekdays: [0, 2] });
const weekly = buildQuantityCommitment(
  "weekly",
  100,
  "minutes",
  {
    direction: "reach",
    minimum: fromInt(10),
    ideal: fromInt(30),
  },
  { kind: "timesPerWeek", times: 2 },
);
const total = buildWeeklyTotalCommitment("total", 100, "minutes", {
  direction: "reach",
  minimum: fromInt(30),
  ideal: fromInt(60),
});
const snapshot = (overrides: Partial<ScoreInput> = {}): ScoreInput => ({
  season: { lengthWeeks: 4, startWeekday: 0 },
  commitments: [daily],
  entries: [],
  pauses: [],
  today: seasonDay(7),
  ...overrides,
});

describe("historyProvenance", () => {
  it("retains scheduled slots, makeup source and exact original entry positions", () => {
    const entries = [
      buildDoneEntry("other", 0),
      buildDoneEntry("daily", 1),
      buildMissedEntry("daily", 2),
    ];
    const weeks = historyProvenance(daily, snapshot({ entries }));
    expect(weeks).toHaveLength(4);
    expect(weeks[0]?.cells).toMatchObject([
      {
        kind: "day",
        day: 0,
        sourceDays: [1],
        entryIndices: [1],
        status: "ideal",
        progress: fromInt(1),
      },
      {
        kind: "day",
        day: 2,
        sourceDays: [2],
        entryIndices: [2],
        status: "missed",
        progress: fromInt(0),
      },
    ]);
    expect(weeks[0]?.extraEntryIndices).toEqual([]);
  });

  it("keeps best-N stable ties and sums all same-day source entries without scoring extras", () => {
    const entries = [
      buildQuantityEntry("weekly", 2, fromInt(15)),
      buildQuantityEntry("weekly", 2, fromInt(15)),
      buildQuantityEntry("weekly", 0, fromInt(30)),
      buildQuantityEntry("weekly", 1, fromInt(10)),
      buildQuantityEntry("weekly", 3, fromInt(30), 8),
    ];
    const first = historyProvenance(weekly, snapshot({ commitments: [weekly], entries }))[0];
    expect(first?.cells).toMatchObject([
      {
        kind: "session",
        day: 2,
        sourceDays: [2],
        entryIndices: [0, 1],
        value: fromInt(30),
        status: "ideal",
      },
      {
        kind: "session",
        day: 0,
        sourceDays: [0],
        entryIndices: [2],
        value: fromInt(30),
        status: "ideal",
      },
    ]);
    expect(first?.extraEntryIndices).toEqual([3]);
  });

  it("uses one weekly opportunity with only on-time entries and no provisional progress", () => {
    const entries = [
      buildQuantityEntry("total", 0, fromInt(20)),
      buildQuantityEntry("total", 5, fromInt(10), 6),
      buildQuantityEntry("total", 1, fromInt(100), 8),
    ];
    const input = snapshot({ commitments: [total], entries, today: seasonDay(6) });
    const open = historyProvenance(total, input)[0];
    expect(open?.cells).toMatchObject([
      {
        kind: "week",
        day: null,
        sourceDays: [0, 5],
        entryIndices: [0, 1],
        value: fromInt(30),
        status: "pending",
        progress: null,
        late: true,
        counted: false,
      },
    ]);
    const closed = historyProvenance(total, { ...input, today: seasonDay(7) })[0];
    expect(closed?.cells).toMatchObject([
      { status: "minimum", progress: fr("1/2"), counted: true, editable: true, final: false },
    ]);
  });

  it("distinguishes an explicit missed entry, recorded zero and an unrecorded slot", () => {
    const entries = [buildMissedEntry("weekly", 0), buildQuantityEntry("weekly", 1, fromInt(0))];
    expect(historyProvenance(weekly, snapshot({ entries }))[0]?.cells).toMatchObject([
      { status: "missed", value: fromInt(0), entryIndices: [0] },
      { status: "below", value: fromInt(0), entryIndices: [1] },
    ]);
    expect(historyProvenance(weekly, snapshot())[0]?.cells).toMatchObject([
      { status: "unrecorded", value: null, entryIndices: [], sourceDays: [], day: null },
      { status: "unrecorded", value: null, entryIndices: [], sourceDays: [], day: null },
    ]);
  });

  it("preserves pending/future versus inclusive counted/editable grace and finality", () => {
    expect(historyProvenance(daily, snapshot({ today: seasonDay(0) }))[0]?.cells).toMatchObject([
      { status: "pending", counted: false, editable: true, final: false, progress: null },
      { status: "future", counted: false, editable: false, final: false, progress: null },
    ]);
    expect(historyProvenance(daily, snapshot({ today: seasonDay(1) }))[0]?.cells[0]).toMatchObject({
      status: "unrecorded",
      counted: true,
      editable: true,
      final: false,
      progress: fromInt(0),
    });
    expect(historyProvenance(daily, snapshot({ today: seasonDay(2) }))[0]?.cells[0]).toMatchObject({
      status: "unrecorded",
      counted: true,
      editable: false,
      final: true,
    });
    expect(historyProvenance(total, snapshot({ today: seasonDay(0) }))[1]?.cells[0]).toMatchObject({
      kind: "week",
      status: "future",
      progress: null,
      editable: false,
    });
  });

  it("only uses eligible makeup evidence and leaves surplus entries non-scoring", () => {
    const entries = [
      buildDoneEntry("daily", 1, 2),
      buildDoneEntry("daily", 1, 3),
      buildDoneEntry("daily", 2),
      buildDoneEntry("daily", 3),
      buildDoneEntry("daily", 7),
    ];
    const first = historyProvenance(daily, snapshot({ entries }))[0];
    expect(first?.cells).toMatchObject([
      { day: 0, sourceDays: [1], entryIndices: [0], late: true },
      { day: 2, sourceDays: [2], entryIndices: [2], late: false },
    ]);
    expect(first?.extraEntryIndices).toEqual([3]);
    // Removing source entries recomputes assignment and evidence, never a stored snapshot.
    expect(
      historyProvenance(daily, snapshot({ entries: entries.slice(3, 4) }))[0]?.cells,
    ).toMatchObject([
      { day: 0, sourceDays: [3], entryIndices: [0], status: "ideal" },
      { day: 2, sourceDays: [], entryIndices: [], status: "unrecorded" },
    ]);
  });

  it("uses season-relative weekdays, not absolute weekday numbers", () => {
    const first = historyProvenance(
      daily,
      snapshot({
        season: { lengthWeeks: 4, startWeekday: 2 },
        entries: [buildDoneEntry("daily", 1)],
      }),
    )[0];
    expect(first?.cells).toMatchObject([
      { day: 5, sourceDays: [1], entryIndices: [0] },
      { day: 0, sourceDays: [], entryIndices: [] },
    ]);
  });

  it("uses prorated best-N and excludes paused entries without inventing opportunities", () => {
    const pauses = [
      buildPauseRequest(
        "weekly",
        0,
        { kind: "fixed", lastDay: seasonDay(3) },
        { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
      ),
    ];
    const entries = [
      buildQuantityEntry("weekly", 0, fromInt(100)),
      buildQuantityEntry("weekly", 4, fromInt(30)),
      buildQuantityEntry("weekly", 5, fromInt(10)),
    ];
    const first = historyProvenance(weekly, snapshot({ entries, pauses }))[0];
    expect(first?.excluded.paused).toEqual([0, 1, 2, 3]);
    expect(first?.cells).toHaveLength(1);
    expect(first?.cells[0]).toMatchObject({ day: 4, entryIndices: [1], status: "ideal" });
    expect(first?.extraEntryIndices).toEqual([2]);
  });

  it.each(["approved", "pending"] as const)("keeps a zero-prorated %s week neutral", (kind) => {
    const one = buildDoneCommitment("one", 100, { kind: "timesPerWeek", times: 1 });
    const pauses = [
      buildPauseRequest(
        "one",
        0,
        { kind: "fixed", lastDay: seasonDay(5) },
        kind === "approved" ? { kind, decidedOn: seasonDay(0), resumedOn: null } : { kind },
      ),
    ];
    const first = historyProvenance(
      one,
      snapshot({ pauses, entries: [buildDoneEntry("one", 0)] }),
    )[0];
    expect(first).toMatchObject({
      status: kind === "approved" ? "paused" : "onHold",
      cells: [],
      extraEntryIndices: [],
    });
  });

  it("keeps excluded specificDays absent, including same-week would-be makeup", () => {
    const pauses = [
      buildPauseRequest(
        "daily",
        0,
        { kind: "fixed", lastDay: seasonDay(0) },
        { kind: "approved", decidedOn: seasonDay(0), resumedOn: null },
      ),
    ];
    const first = historyProvenance(
      daily,
      snapshot({ pauses, entries: [buildDoneEntry("daily", 1)] }),
    )[0];
    expect(first?.cells).toHaveLength(1);
    expect(first?.cells[0]).toMatchObject({ day: 2, sourceDays: [1], entryIndices: [0] });
    expect(first?.excluded.paused).toEqual([0]);
  });

  it("respects a rejected pause's extended weekly acceptance and counting windows", () => {
    const pauses = [
      buildPauseRequest(
        "total",
        5,
        { kind: "fixed", lastDay: seasonDay(6) },
        { kind: "rejected", decidedOn: seasonDay(9) },
      ),
    ];
    const entries = [
      buildQuantityEntry("total", 5, fromInt(60), 10),
      buildQuantityEntry("total", 6, fromInt(100), 11),
    ];
    const input = snapshot({ entries, pauses, today: seasonDay(10) });
    expect(historyProvenance(total, input)[0]?.cells[0]).toMatchObject({
      status: "ideal",
      sourceDays: [5],
      entryIndices: [0],
      late: true,
      counted: true,
      editable: true,
      final: false,
    });
    expect(historyProvenance(total, { ...input, today: seasonDay(11) })[0]?.cells[0]).toMatchObject(
      {
        final: true,
        editable: false,
      },
    );
  });

  it("retains direction-specific exact outcomes, including recorded zero for limit", () => {
    const limit = buildQuantityCommitment(
      "limit",
      100,
      "glasses",
      {
        direction: "limit",
        ideal: fromInt(1),
        tolerance: fromInt(3),
      },
      { kind: "specificDays", weekdays: [0, 1, 2] },
    );
    const entries = [0, 2, 4].map((value, day) => buildQuantityEntry("limit", day, fromInt(value)));
    expect(historyProvenance(limit, snapshot({ entries }))[0]?.cells).toMatchObject([
      { status: "ideal", value: fromInt(0), progress: fromInt(1) },
      { status: "minimum", value: fromInt(2), progress: fr("3/4") },
      { status: "below", value: fromInt(4), progress: fromInt(0) },
    ]);
  });

  it.each([daily, weekly, total])(
    "reconciles all history opportunities with the scoring walk for $id",
    (commitment) => {
      for (const today of [0, 1, 6, 7, 8, 28, 40]) {
        const input = snapshot({
          commitments: [commitment],
          today: seasonDay(today),
          entries: [buildQuantityEntry(commitment.id, 0, fromInt(30))],
        });
        const before = scoreMember(input);
        const walk = seasonSessions(commitment, input);
        const cells = historyProvenance(commitment, input).flatMap((w) => w.cells);
        expect(cells).toHaveLength(walk.all.length);
        expect(cells.filter((c) => c.counted).map((c) => c.progress)).toEqual(
          walk.soFar.map((s) => s.progress),
        );
        expect(cells.map((c) => c.value)).toEqual(walk.all.map((s) => s.value));
        expect(scoreMember(input)).toEqual(before);
      }
    },
  );
});
