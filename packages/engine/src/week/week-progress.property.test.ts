import { array, assert, constantFrom, integer, oneof, property, record } from "fast-check";
import { expect, it } from "vitest";
import type { Season, Weekday } from "../calendar/season-calendar.ts";
import { seasonDay, weekdayOf } from "../calendar/season-calendar.ts";
import type { Commitment } from "../commitment/commitment.ts";
import { div, fromInt, mean, mul, sum } from "../fraction/fraction.ts";
import type { PauseDecision } from "../pause/pause.ts";
import { pauseAwareWeekSessions } from "../pause/pause-aware-week.ts";
import { scoreMember } from "../scoring/member-score.ts";
import {
  buildPauseRequest,
  buildQuantityCommitment,
  buildQuantityEntry,
  buildWeeklyTotalCommitment,
} from "../test-support/builders.ts";
import { weekProgress } from "./week-progress.ts";

const SETTLED_DAY = 28; // every week of a 4-week season is past its grace deadline
const approved: PauseDecision = { kind: "approved", decidedOn: seasonDay(0), resumedOn: null };
const pending: PauseDecision = { kind: "pending" };
const pagesTarget = { direction: "reach", minimum: fromInt(1), ideal: fromInt(5) } as const;
const gym = (times: number) =>
  buildQuantityCommitment("gym", 100, "times", pagesTarget, { kind: "timesPerWeek", times });
const reading = buildWeeklyTotalCommitment("gym", 100, "minutes", {
  direction: "reach",
  minimum: fromInt(60),
  ideal: fromInt(150),
});
const specific = buildQuantityCommitment("gym", 100, "pages", pagesTarget, {
  kind: "specificDays",
  weekdays: [0, 3, 5],
});

const scenario = record({
  startWeekday: constantFrom<Weekday>(0, 1, 2, 3, 4, 5, 6),
  commitment: constantFrom<Commitment>(gym(3), gym(1), reading, specific),
  entries: array(
    record({
      day: integer({ min: 0, max: 27 }),
      lag: integer({ min: 0, max: 3 }),
      value: integer({ min: 0, max: 200 }),
    }),
    { maxLength: 14 },
  ),
  pauses: array(
    record({
      start: integer({ min: 0, max: 27 }),
      len: integer({ min: 0, max: 10 }),
      pending: constantFrom(true, false),
    }),
    { maxLength: 2 },
  ),
  // Biased to the settled range so the scoreMember comparison (today >= 28) runs often.
  today: oneof(integer({ min: 28, max: 40 }), integer({ min: 0, max: 40 })),
});

it("WP-S6: weekProgress matches pauseAwareWeekSessions per week and scoreMember points", () => {
  assert(
    property(scenario, (s) => {
      const sn: Season = { lengthWeeks: 4, startWeekday: s.startWeekday };
      const id = s.commitment.id;
      const entries = s.entries.map((e) =>
        buildQuantityEntry(id, e.day, fromInt(e.value), e.day + e.lag),
      );
      const pauses = s.pauses.map((p) =>
        buildPauseRequest(
          id,
          p.start,
          { kind: "fixed", lastDay: seasonDay(p.start + p.len) },
          p.pending ? pending : approved,
        ),
      );
      const today = seasonDay(s.today);
      const progresses = [];
      for (let week = 0; week < 4; week++) {
        const wp = weekProgress({
          season: sn,
          commitment: s.commitment,
          week,
          entries,
          pauses,
          today,
        });
        const weekEntries = entries.filter((e) => e.day >= week * 7 && e.day < week * 7 + 7);
        const plain = pauseAwareWeekSessions(s.commitment, week, pauses, weekEntries, today, {
          season: sn,
        });
        expect(wp.status).toBe(plain.status);
        if (wp.status !== "scored" || plain.status !== "scored") continue;
        expect(wp.sessionsTarget).toBe(plain.sessions.length);
        expect(wp.sessionsDone).toBe(plain.sessions.filter((x) => x.consistent).length);
        expect(wp.progress).toEqual(mean(plain.sessions.map((x) => x.progress)));
        // The shown value is the sum of the counted session values, null when none counted.
        const counted = plain.sessions.flatMap((x) => (x.value === null ? [] : [x.value]));
        expect(wp.value).toEqual(counted.length === 0 ? null : sum(counted));
        const { schedule } = s.commitment;
        if (schedule.period === "perSession" && schedule.frequency.kind === "specificDays") {
          // One slot per scheduled weekday no pause excludes, in the schedule's order.
          const { weekdays } = schedule.frequency;
          const excluded = new Set([...wp.excluded.paused, ...wp.excluded.onHold]);
          const weekDays = Array.from({ length: 7 }, (_, i) => seasonDay(week * 7 + i));
          const active = weekdays
            .map((wd) => weekDays.find((d) => weekdayOf(sn, d) === wd))
            .filter((d) => d !== undefined && !excluded.has(d));
          expect(wp.slots.map((slot) => slot.day)).toEqual(active);
        } else {
          expect(wp.slots).toEqual([]);
        }
        // Every opportunity weighs the same: a week stands for sessionsTarget of them.
        for (let i = 0; i < wp.sessionsTarget; i++) progresses.push(wp.progress);
      }
      // D12/R1: points count only settled opportunities, which are all of them once every
      // week is past its grace deadline.
      if (s.today < SETTLED_DAY) return;
      const { points } = scoreMember({
        season: sn,
        commitments: [s.commitment],
        entries,
        pauses,
        today,
      });
      // weight 100% = 1000 points x the average progress of the active opportunities.
      const expected =
        progresses.length === 0
          ? fromInt(0)
          : mul(fromInt(1000), div(sum(progresses), fromInt(progresses.length)));
      expect(points).toEqual(expected);
    }),
  );
});
