import { describe, expect, it } from "vitest";
import {
  dayRowFixture,
  type Entry,
  entryFixture,
  weekRowFixture,
} from "../../testing/fixtures/today.ts";
import { loggedBefore, loggedThisWeek, loggedToday } from "./logged-totals.ts";

const minutes = (value: string, forDate = "2026-10-02") =>
  entryFixture({ kind: "quantity", value }, { forDate: forDate as Entry["forDate"] });

describe("loggedToday", () => {
  it("adds the day's quantity entries exactly and ignores other days, done and missed", () => {
    const row = dayRowFixture({
      entries: [
        minutes("25.5"),
        minutes("10"),
        minutes("30", "2026-10-01"),
        entryFixture({ kind: "missed" }),
      ],
    });
    expect(loggedToday(row, "2026-10-02")).toBe(3550n);
  });

  it("counts every entry when the day is unknown", () => {
    expect(loggedToday(dayRowFixture({ entries: [minutes("5", "2026-10-01")] }), undefined)).toBe(
      500n,
    );
  });
});

describe("loggedThisWeek / loggedBefore", () => {
  const weekly = (value: string | null) =>
    weekRowFixture({
      measure: {
        unit: "minutes",
        customLabel: null,
        precision: "integer",
        target: { direction: "reach", minimum: "60", ideal: "150" },
        schedule: { period: "weeklyTotal" },
      },
      progress: {
        value,
        target: { direction: "reach", minimum: "60", ideal: "150" },
        sessionsDone: 0,
        sessionsTarget: 1,
        percent: 0,
      },
    });

  it("takes the week's sum from the server, zero before anything is logged", () => {
    expect(loggedThisWeek(weekly("90"))).toBe(9000n);
    expect(loggedThisWeek(weekly(null))).toBe(0n);
  });

  it("uses the week for a weekly total and the day for anything else", () => {
    expect(loggedBefore(weekly("90"), "2026-10-02")).toBe(9000n);
    expect(loggedBefore(dayRowFixture({ entries: [minutes("20")] }), "2026-10-02")).toBe(2000n);
  });
});
