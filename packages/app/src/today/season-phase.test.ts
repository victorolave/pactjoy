import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { circleId, seasonId } from "../shared/ids.ts";
import { seasonFixture } from "../testing/builders.ts";
import { epochDay, localDate, localDateOfEpochDay } from "../time/local-date.ts";
import { seasonPhase, weekOf } from "./season-phase.ts";

const DAY = (n: number) => localDateOfEpochDay(epochDay(localDate("2026-10-01")) + n);
const season = (options: { status?: "pactOpen" | "active"; start?: number | null }) =>
  seasonFixture({
    id: seasonId("s1"),
    circleId: circleId("c1"),
    status: options.status ?? "active",
    lengthWeeks: 4,
    actualStart: options.start === null ? null : DAY(options.start ?? 0),
  });

describe("seasonPhase", () => {
  it.each([
    ["pact open", { status: "pactOpen" as const, start: null }, 0, { phase: "pactOpen" }],
    ["active without a start day", { start: null }, 0, { phase: "notStarted" }],
    ["before the start", {}, -1, { phase: "notStarted" }],
    [
      "first day",
      {},
      0,
      { phase: "active", day: seasonDay(0), scoringDay: seasonDay(0), lastDay: seasonDay(27) },
    ],
    [
      "last day",
      {},
      27,
      { phase: "active", day: seasonDay(27), scoringDay: seasonDay(27), lastDay: seasonDay(27) },
    ],
    [
      "the day after the last day",
      {},
      28,
      { phase: "ended", day: seasonDay(28), scoringDay: seasonDay(27), lastDay: seasonDay(27) },
    ],
  ])("%s", (_name, options, today, expected) => {
    expect(seasonPhase(season(options), DAY(today))).toEqual(expected);
  });
});

describe("weekOf", () => {
  it.each([
    [0, 1],
    [6, 1],
    [7, 2],
    [27, 4],
  ])("scoring day %i is week %i", (day, week) => {
    expect(weekOf(seasonDay(day))).toBe(week);
  });
});
