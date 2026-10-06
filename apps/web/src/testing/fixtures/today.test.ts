import type { TodayView } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import {
  activeTodayFixture,
  dayRowFixture,
  endedTodayFixture,
  pactOpenTodayFixture,
  weekRowFixture,
} from "./today.ts";

type Active = Extract<TodayView, { state: "active" | "ended" }>;

const DAY_MS = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
/** Monday = 0, like the engine's Weekday. */
const weekdayOf = (date: string) => (new Date(utc(date)).getUTCDay() + 6) % 7;
const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY_MS);

const scheduleOf = (row: Active["rows"][number]) => row.measure.schedule;

describe("Today fixtures only describe what the server can produce", () => {
  it("a pactOpen fixture has an empty own-commitment list", () => {
    expect(pactOpenTodayFixture().myCommitments).toEqual([]);
  });

  it("a day row implies perSession + specificDays (today-rows.ts)", () => {
    for (const row of [dayRowFixture(), ...activeTodayFixture().rows]) {
      if (row.kind !== "day") continue;
      const schedule = scheduleOf(row);
      expect(schedule.period).toBe("perSession");
      if (schedule.period === "perSession") {
        expect(schedule.frequency.kind).toBe("specificDays");
      }
    }
  });

  it("scheduledToday agrees with the weekday of today", () => {
    const view = activeTodayFixture();
    const weekday = weekdayOf(view.today);
    for (const row of view.rows) {
      if (row.kind !== "day") continue;
      const schedule = scheduleOf(row);
      if (schedule.period !== "perSession" || schedule.frequency.kind !== "specificDays") {
        throw new Error("day row without specificDays");
      }
      expect(row.scheduledToday).toBe(schedule.frequency.weekdays.includes(weekday as never));
    }
  });

  it("a week row carries progress and is never a specificDays day row", () => {
    const row = weekRowFixture();
    expect(row.kind).toBe("week");
    expect(row.progress).not.toBeNull();
    expect(row.progress?.sessionsTarget).toBe(3);
  });

  it("the active fixture mixes both row kinds", () => {
    expect(activeTodayFixture().rows.map((row) => row.kind)).toEqual(["day", "week"]);
  });

  it("the active score is scored and own, and the standings contain the viewer", () => {
    const view = activeTodayFixture();
    expect(view.summary.score).toMatchObject({
      kind: "scored",
      scope: "own",
      memberId: view.viewerId,
    });
    expect(view.standings.rows.map((row) => row.memberId)).toContain(view.viewerId);
    expect(view.standings.eligibleParticipantCount).toBe(view.standings.rows.length);
  });

  it("daysLeft follows from today, actualStart and the season length", () => {
    const view = activeTodayFixture();
    const actualStart = view.season.actualStart;
    if (actualStart === null) throw new Error("active season without actualStart");
    const dayIndex = daysBetween(actualStart, view.today);
    expect(view.summary.daysLeft).toBe(view.season.lengthWeeks * 7 - 1 - dayIndex);
    expect(view.summary.daysLeft).toBe(23);
    expect(view.summary.week).toBe(Math.floor(dayIndex / 7) + 1);
  });

  it("the ended fixture is past the last day with daysLeft 0", () => {
    const view = endedTodayFixture();
    expect(view.state).toBe("ended");
    expect(view.summary.daysLeft).toBe(0);
    expect(view.summary.week).toBe(view.summary.weekCount);
  });
});
