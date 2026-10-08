import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
  SEASON_START,
} from "../testing/entry-fixtures.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { seasonPhase } from "../today/season-phase.ts";
import { seasonWeeks } from "./weekly-progress.query.ts";

const DAILY = {
  unit: "done",
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
} as const;

const row = (id: string, name: string, isViewer: boolean, rank: number) => ({
  memberId: memberId(id),
  displayName: name,
  isViewer,
  rank,
  points: 0,
});

async function setup() {
  const app = createTestApp({ now: localInstant(SEASON_START), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, DAILY);
  const rows = [row("member-andrea", "Andrea", true, 1), row("member-victor", "Victor", false, 2)];
  return { app, given, rows };
}

describe("seasonWeeks (weekly-progress)", () => {
  it("builds season weeks array for all weeks of an active season", async () => {
    const { given, rows } = await setup();
    const phase = seasonPhase(given.season, SEASON_START);
    if (phase.phase !== "active") throw new Error("expected active phase");

    const weeks = seasonWeeks({
      season: given.season,
      actualStart: SEASON_START,
      today: seasonDay(0),
      phase,
      standingsRows: rows,
      data: { entries: [], pauses: [] },
    });

    expect(weeks).toHaveLength(given.season.lengthWeeks);
    const [w0, w1] = weeks;
    expect(w0).toMatchObject({
      weekIndex: 0,
      start: SEASON_START,
      end: localDateOfSeasonDay(seasonDay(6), SEASON_START),
      timing: "current",
      facts: { counted: false, editable: true, final: false },
    });
    expect(w0?.members).toHaveLength(2);
    expect(w0?.members[0]).toMatchObject({
      memberId: "member-andrea",
      points: 0,
      consistency: null,
      idealCompletion: null,
    });

    expect(w1).toMatchObject({
      weekIndex: 1,
      timing: "future",
      facts: { counted: false, editable: false, final: false },
    });
    expect(w1?.members[0]).toMatchObject({
      memberId: "member-andrea",
      points: null,
      consistency: null,
      idealCompletion: null,
    });
  });

  it("marks past weeks as past with correct grace facts", async () => {
    const { given, rows } = await setup();
    const today = seasonDay(8);
    const phase = seasonPhase(given.season, localDateOfSeasonDay(today, SEASON_START));
    if (phase.phase !== "active") throw new Error("expected active phase");

    const weeks = seasonWeeks({
      season: given.season,
      actualStart: SEASON_START,
      today,
      phase,
      standingsRows: rows,
      data: { entries: [], pauses: [] },
    });

    const [w0, w1, w2] = weeks;
    expect(w0).toMatchObject({
      weekIndex: 0,
      timing: "past",
      facts: { counted: true, editable: false, final: true },
    });
    expect(w1).toMatchObject({
      weekIndex: 1,
      timing: "current",
      facts: { counted: false, editable: true, final: false },
    });
    expect(w2).toMatchObject({
      weekIndex: 2,
      timing: "future",
      facts: { counted: false, editable: false, final: false },
    });
  });

  it("marks all weeks as past when season is ended", async () => {
    const { given, rows } = await setup();
    const endedDay = seasonDay(given.season.lengthWeeks * 7 + 1);
    const phase = seasonPhase(given.season, localDateOfSeasonDay(endedDay, SEASON_START));
    if (phase.phase !== "ended") throw new Error("expected ended phase");

    const weeks = seasonWeeks({
      season: given.season,
      actualStart: SEASON_START,
      today: endedDay,
      phase,
      standingsRows: rows,
      data: { entries: [], pauses: [] },
    });

    expect(weeks.every((w) => w.timing === "past")).toBe(true);
    expect(weeks.every((w) => w.facts.counted)).toBe(true);
  });
});
