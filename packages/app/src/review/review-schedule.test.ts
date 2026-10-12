import { describe, expect, it } from "vitest";
import type { ReviewCadenceWeeks, SeasonLengthWeeks } from "../season/season.ts";
import { createFixedOffsetTimeZone } from "../testing/fixed-time-zone.ts";
import { instant } from "../time/instant.ts";
import { epochDay, type LocalDate, localDate } from "../time/local-date.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import type { ReviewRecord } from "./review.ts";
import {
  BASELINE_PERIOD,
  dueSlot,
  midSeasonPeriodIndex,
  nextReviewDate,
  type ReviewDay,
  type ReviewSlot,
  reviewDayOf,
  reviewPeriods,
  reviewSlots,
} from "./review-schedule.ts";

// Reference calendar of the spec: season day 1 = Tue 2026-09-08, day n = 2026-09-08 + n - 1.
const START = localDate("2026-09-08");
const day = (n: number): ReviewDay => ({ kind: "day", day: n });
const ceilDiv = (a: number, b: number) => (a - (a % b)) / b + (a % b === 0 ? 0 : 1);
const smaller = (a: number, b: number) => (a < b ? a : b);
const dateOfDay = (n: number): LocalDate => localDateOfSeasonDay((n - 1) as never, START);

type Stored = Pick<ReviewRecord, "periodIndex" | "status">;
const slotsAt = (
  length: SeasonLengthWeeks,
  cadence: ReviewCadenceWeeks,
  today: ReviewDay,
  stored: readonly Stored[] = [],
  pactClosed = true,
): readonly ReviewSlot[] =>
  reviewSlots({ lengthWeeks: length, cadence, pactClosed, today, stored });
const due = (slots: readonly ReviewSlot[]) => slots.filter((s) => s.status === "due");
const dueIndex = (slots: readonly ReviewSlot[]) => dueSlot(slots)?.index ?? null;

const ALL: readonly (readonly [SeasonLengthWeeks, ReviewCadenceWeeks])[] = [4, 6, 8, 12].flatMap(
  (length) =>
    ([1, 2, 3] as const).map((cadence) => [length as SeasonLengthWeeks, cadence] as const),
);

describe("reviewPeriods (REQ-A3 conventions, section 0)", () => {
  it.each(ALL)(
    "P = ceil(L/c) with the last period shortened: %iw, cadence %i",
    (length, cadence) => {
      const periods = reviewPeriods(length, cadence);

      expect(periods).toHaveLength(ceilDiv(length, cadence));
      expect(periods.map((p) => p.index)).toEqual(periods.map((_, i) => i + 1));
      expect(periods[0]?.firstWeek).toBe(1);
      expect(periods.at(-1)?.lastWeek).toBe(length);
      for (const [i, period] of periods.entries()) {
        expect(period.firstWeek).toBe(i * cadence + 1);
        expect(period.lastWeek).toBe(smaller((i + 1) * cadence, length));
        expect(period.kind).toBe(i === periods.length - 1 ? "closing" : "interim");
      }
    },
  );

  it("there is always at least one interim review (P >= 2)", () => {
    for (const [length, cadence] of ALL) {
      expect(reviewPeriods(length, cadence).length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each([
    // [length, cadence, due-starts of periods 1..P-1 and the closing] (SC-10..SC-14)
    [4, 1, [8, 15, 22, 29]],
    [8, 2, [15, 29, 43, 57]],
    [12, 3, [22, 43, 64, 85]],
    [4, 3, [22, 29]],
    [8, 3, [22, 43, 57]],
  ] as const)("%iw cadence %i is due from days %j", (length, cadence, starts) => {
    expect(reviewPeriods(length, cadence).map((p) => p.dueFromDay)).toEqual(starts);
  });

  it("each interim window ends the day before the next review starts; closing has no end", () => {
    for (const [length, cadence] of ALL) {
      const periods = reviewPeriods(length, cadence);
      for (const [i, period] of periods.entries()) {
        const next = periods[i + 1];
        expect(period.dueToDay).toBe(
          next?.dueFromDay === undefined || next.dueFromDay === null ? null : next.dueFromDay - 1,
        );
      }
    }
  });

  it("the baseline is a full SRBAI with no summary weeks, due through day 7 (REQ-B1, REQ-B3)", () => {
    expect(BASELINE_PERIOD).toMatchObject({
      index: 0,
      kind: "baseline",
      srbai: "full",
      firstWeek: null,
      lastWeek: null,
      dueFromDay: null,
      dueToDay: 7,
    });
  });
});

describe("full SRBAI selection (REQ-A2, REQ-A3, SC-20..26)", () => {
  // [length, cadence, the one interim review that is full SRBAI]
  const MID: readonly (readonly [SeasonLengthWeeks, ReviewCadenceWeeks, number])[] = [
    [4, 1, 2],
    [4, 2, 1],
    [4, 3, 1],
    [6, 1, 3],
    [6, 2, 1], // tie between weeks 2 and 4: the lowest wins (SC-23)
    [6, 3, 1],
    [8, 1, 4],
    [8, 2, 2],
    [8, 3, 1], // shortened last period (SC-24)
    [12, 1, 6],
    [12, 2, 3],
    [12, 3, 2],
  ];

  it("covers every (length, cadence) combination", () => {
    expect(MID.map(([l, c]) => [l, c])).toEqual(ALL.map(([l, c]) => [l, c]));
  });

  it.each(MID)("%iw cadence %i: interim review %i is the full one", (length, cadence, mid) => {
    expect(midSeasonPeriodIndex(length, cadence)).toBe(mid);
    const periods = reviewPeriods(length, cadence);
    const full = periods.filter((p) => p.kind === "interim" && p.srbai === "full");
    expect(full.map((p) => p.index)).toEqual([mid]);
    for (const period of periods) {
      if (period.kind === "interim" && period.index !== mid) expect(period.srbai).toBe("item1");
    }
  });

  it("the closing review is full whatever the mid-season selection (SC-26)", () => {
    for (const [length, cadence] of ALL) {
      expect(reviewPeriods(length, cadence).at(-1)?.srbai).toBe("full");
    }
  });
});

describe("reviewSlots: due, lapse and no accumulation (REQ-R1..R6)", () => {
  it("SC-01: the first interim review is due on the first day of period 2, not before", () => {
    expect(dueIndex(slotsAt(8, 2, day(14)))).toBeNull();
    const slots = slotsAt(8, 2, day(15));
    expect(dueIndex(slots)).toBe(1);
    expect(slots[1]).toMatchObject({ kind: "interim", srbai: "item1", dueToDay: 28 });
  });

  it("SC-02: it stays due every day until the window ends", () => {
    for (const d of [15, 22, 28]) expect(dueIndex(slotsAt(8, 2, day(d)))).toBe(1);
  });

  it("SC-03: it lapses the day the next review becomes due and is replaced by that one", () => {
    const slots = slotsAt(8, 2, day(29));
    expect(slots[1]?.status).toBe("lapsed");
    expect(dueIndex(slots)).toBe(2);
  });

  it("SC-04: reviews never accumulate: ignoring periods 1 and 2, only period 3 is offered", () => {
    const slots = slotsAt(8, 2, day(43));
    expect(due(slots).map((s) => s.index)).toEqual([3]);
    expect(slots.filter((s) => s.status === "lapsed").map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("SC-05: a submitted review stops being due", () => {
    const stored: Stored[] = [{ periodIndex: 1, status: "completed" }];
    expect(dueIndex(slotsAt(8, 2, day(20), stored))).toBeNull();
    expect(slotsAt(8, 2, day(20), stored)[1]?.status).toBe("completed");
  });

  it("SC-06: the last interim review lapses when the closing one is due, which never lapses", () => {
    expect(dueIndex(slotsAt(8, 2, day(56)))).toBe(3);
    const closing = slotsAt(8, 2, day(57));
    expect(closing[3]?.status).toBe("lapsed");
    expect(dueSlot(closing)).toMatchObject({ index: 4, kind: "closing", srbai: "full" });
    expect(dueIndex(slotsAt(8, 2, day(70)))).toBe(4);
    expect(dueIndex(slotsAt(8, 2, day(400)))).toBe(4);
  });

  it("a submitted closing review is completed, not due", () => {
    const slots = slotsAt(8, 2, day(60), [{ periodIndex: 4, status: "completed" }]);
    expect(slots[4]?.status).toBe("completed");
    expect(dueSlot(slots)).toBeNull();
  });

  it("SC-08 and REQ-R10: nothing is due before the first period ends, even before the start", () => {
    expect(dueIndex(slotsAt(8, 2, day(14), [], true))).toBeNull();
    expect(
      due(slotsAt(8, 2, { kind: "beforeStart" }, [{ periodIndex: 0, status: "skipped" }])),
    ).toEqual([]);
  });

  it("SC-10 and SC-12: a review lapses on the due-start of the next one", () => {
    expect(slotsAt(4, 1, day(22))[3]?.status).toBe("due");
    expect(slotsAt(4, 1, day(21))[3]?.status).toBe("upcoming");
    expect(slotsAt(4, 1, day(22))[2]?.status).toBe("lapsed");
    expect(slotsAt(4, 1, day(21))[2]?.status).toBe("due");
    expect(slotsAt(12, 3, day(42))[1]?.status).toBe("due");
    expect(slotsAt(12, 3, day(43))[1]?.status).toBe("lapsed");
  });

  it("SC-13: 4w cadence 3 has a shortened closing period due from day 29", () => {
    expect(slotsAt(4, 3, day(21))[1]?.status).toBe("upcoming");
    expect(dueIndex(slotsAt(4, 3, day(22)))).toBe(1);
    expect(dueIndex(slotsAt(4, 3, day(28)))).toBe(1);
    expect(dueSlot(slotsAt(4, 3, day(29)))).toMatchObject({ index: 2, kind: "closing" });
  });

  it("SC-14: 8w cadence 3 has interim windows d22-42 and d43-56, closing from d57", () => {
    expect(dueIndex(slotsAt(8, 3, day(22)))).toBe(1);
    expect(dueIndex(slotsAt(8, 3, day(42)))).toBe(1);
    expect(dueIndex(slotsAt(8, 3, day(43)))).toBe(2);
    expect(dueIndex(slotsAt(8, 3, day(56)))).toBe(2);
    expect(dueSlot(slotsAt(8, 3, day(57)))).toMatchObject({ index: 3, kind: "closing" });
  });

  it.each(ALL)(
    "exactly one slot is due at a time and each period's edges are exact: %iw cadence %i",
    (length, cadence) => {
      const periods = reviewPeriods(length, cadence);
      for (let d = 1; d <= length * 7 + 14; d++) {
        expect(due(slotsAt(length, cadence, day(d))).length).toBeLessThanOrEqual(1);
      }
      for (const period of periods) {
        const from = period.dueFromDay as number;
        expect(slotsAt(length, cadence, day(from - 1))[period.index]?.status).toBe("upcoming");
        expect(slotsAt(length, cadence, day(from))[period.index]?.status).toBe("due");
        if (period.dueToDay !== null) {
          expect(slotsAt(length, cadence, day(period.dueToDay))[period.index]?.status).toBe("due");
          expect(slotsAt(length, cadence, day(period.dueToDay + 1))[period.index]?.status).toBe(
            "lapsed",
          );
        }
      }
    },
  );
});

describe("reviewSlots: the baseline (REQ-B1, REQ-B2, REQ-B6, SC-40..45)", () => {
  it("SC-40: offered from pact close, before the start, through day 7; lapsed from day 8", () => {
    expect(dueIndex(slotsAt(8, 2, { kind: "beforeStart" }))).toBe(0);
    expect(dueIndex(slotsAt(8, 2, day(1)))).toBe(0);
    expect(dueIndex(slotsAt(8, 2, day(7)))).toBe(0);
    const lapsed = slotsAt(8, 2, day(8));
    expect(dueIndex(lapsed)).toBeNull();
    expect(lapsed[0]?.status).toBe("lapsed");
  });

  it("is not offered while the pact is still open", () => {
    const slots = slotsAt(8, 2, { kind: "beforeStart" }, [], false);
    expect(slots[0]?.status).toBe("upcoming");
    expect(dueSlot(slots)).toBeNull();
  });

  it("SC-41: a skipped baseline is never offered again", () => {
    const slots = slotsAt(8, 2, day(3), [{ periodIndex: 0, status: "skipped" }]);
    expect(slots[0]?.status).toBe("skipped");
    expect(dueSlot(slots)).toBeNull();
  });

  it("SC-42: a taken baseline stops the offer", () => {
    const slots = slotsAt(8, 2, day(3), [{ periodIndex: 0, status: "completed" }]);
    expect(slots[0]?.status).toBe("completed");
    expect(dueSlot(slots)).toBeNull();
  });

  it("SC-45: baseline and the first review never overlap (4w cadence 1)", () => {
    expect(dueIndex(slotsAt(4, 1, day(7)))).toBe(0);
    expect(dueIndex(slotsAt(4, 1, day(8)))).toBe(1);
  });
});

describe("reviewDayOf (the one conversion to 1-based days)", () => {
  it("is beforeStart until the start date, then 1-based", () => {
    expect(reviewDayOf(localDate("2026-09-07"), START)).toEqual({ kind: "beforeStart" });
    expect(reviewDayOf(START, START)).toEqual(day(1));
    expect(reviewDayOf(localDate("2026-09-22"), START)).toEqual(day(15));
  });

  it("is beforeStart when the season has no start yet", () => {
    expect(reviewDayOf(localDate("2026-09-22"), null)).toEqual({ kind: "beforeStart" });
  });

  it("the same instant is on different season days in two time zones", () => {
    const at = instant(epochDay(localDate("2026-09-22")) * 86_400_000 + 3 * 3_600_000); // 03:00Z
    const bogota = createFixedOffsetTimeZone({ offsetMinutes: -300 }).localDateAt(at, "x" as never);
    const tokyo = createFixedOffsetTimeZone({ offsetMinutes: 540 }).localDateAt(at, "x" as never);

    expect(bogota).toBe("2026-09-21");
    expect(tokyo).toBe("2026-09-22");
    expect(dueIndex(slotsAt(8, 2, reviewDayOf(bogota, START)))).toBeNull();
    expect(dueIndex(slotsAt(8, 2, reviewDayOf(tokyo, START)))).toBe(1);
  });
});

describe("nextReviewDate (REQ-S9, SC-44, SC-54)", () => {
  it("is the due-start date of the next review", () => {
    // 8w cadence 2: due-starts d15 (Sep 22), d29 (Oct 6), d43 (Oct 20), closing d57 (Nov 3).
    expect(nextReviewDate(8, 2, 0, START)).toBe(dateOfDay(15));
    expect(nextReviewDate(8, 2, 1, START)).toBe("2026-10-06");
    expect(nextReviewDate(8, 2, 2, START)).toBe("2026-10-20");
    expect(nextReviewDate(8, 2, 3, START)).toBe("2026-11-03");
  });

  it("is none after the closing review", () => {
    expect(nextReviewDate(8, 2, 4, START)).toBeNull();
    expect(nextReviewDate(4, 3, 2, START)).toBeNull();
  });

  it("after the last interim review it is the closing date, also when shortened", () => {
    expect(nextReviewDate(4, 3, 1, START)).toBe(dateOfDay(29));
  });
});
