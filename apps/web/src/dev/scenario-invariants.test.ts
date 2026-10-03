import type { TodayView } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./scenarios.ts";

type Running = Extract<TodayView, { state: "active" | "ended" }>;

const running = (view: TodayView): Running | null =>
  view.state === "active" || view.state === "ended" ? view : null;

const weekdayOf = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

describe("scenarios only describe what the server can produce", () => {
  const views = SCENARIOS.map((scenario) => [scenario.id, scenario.today()] as const);

  it.each(views)(
    "%s: a day row is perSession + specificDays, a week row has progress",
    (_id, view) => {
      for (const row of running(view)?.rows ?? []) {
        const { schedule } = row.measure;
        if (row.kind === "day") {
          expect(schedule.period).toBe("perSession");
          if (schedule.period === "perSession")
            expect(schedule.frequency.kind).toBe("specificDays");
        } else if (row.opportunity.state !== "paused" && row.opportunity.state !== "onHold") {
          expect(row.progress).not.toBeNull();
        }
      }
    },
  );

  it.each(views)(
    "%s: scheduledToday agrees with the weekday of the day on display",
    (_id, view) => {
      const data = running(view);
      if (data === null) return;
      const refDate = data.state === "ended" ? "2026-10-25" : data.today;
      for (const row of data.rows) {
        if (row.kind !== "day") continue;
        const { schedule } = row.measure;
        if (schedule.period !== "perSession" || schedule.frequency.kind !== "specificDays")
          continue;
        expect(row.scheduledToday).toBe(
          schedule.frequency.weekdays.includes(weekdayOf(refDate) as never),
        );
      }
    },
  );

  it.each(views)(
    "%s: week-bound rows earn no points until counted, as the server returns them",
    (_id, view) => {
      for (const row of running(view)?.rows ?? []) {
        const { schedule } = row.measure;
        const weekBound =
          schedule.period === "weeklyTotal" || schedule.frequency.kind === "timesPerWeek";
        if (weekBound) expect(row.points.earned).toBeNull();
      }
    },
  );

  it.each(views)("%s: pointsToday is the day-bound rows' earned points, no more", (_id, view) => {
    const data = running(view);
    if (data === null) return;
    const dayBound = data.rows
      .filter((row) => row.kind === "day")
      .reduce((total, row) => total + (row.points.earned ?? 0), 0);
    expect(Math.abs(data.summary.pointsToday - dayBound)).toBeLessThanOrEqual(1);
  });

  it.each(views)("%s: limitPercents only on a per-session integer limit", (_id, view) => {
    for (const row of running(view)?.rows ?? []) {
      if (row.points.limitPercents === null) continue;
      expect(row.measure.unit).not.toBe("done");
      if (row.measure.unit === "done") continue;
      expect(row.measure.target.direction).toBe("limit");
      expect(row.measure.precision).toBe("integer");
      expect(row.points.limitPercents).toHaveLength(13);
    }
  });

  it.each(views)("%s: a logged row has an entry, an open one has none", (_id, view) => {
    for (const row of running(view)?.rows ?? []) {
      if (row.opportunity.state === "logged") expect(row.entries.length).toBeGreaterThan(0);
      if (row.opportunity.state === "open" && row.kind === "day") {
        expect(row.entries).toEqual([]);
      }
    }
  });
});
