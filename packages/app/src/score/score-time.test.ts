import { type Frequency, fromInt, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { createIntlTimeZone } from "../adapters/intl-time-zone.ts";
import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { instant } from "../time/instant.ts";
import { epochDay, localDate } from "../time/local-date.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import { memberScore } from "./member-score.query.ts";
import { standings } from "./standings.query.ts";

// The fixture season starts on Thursday 2026-10-01 (day 0) and lasts 4 weeks.
const SEASON_START = localDate("2026-10-01");
const DAY = (n: number) => localDateOfSeasonDay(seasonDay(n), SEASON_START);
const EVERY_DAY = { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] } as const;
const reach = (frequency: Frequency): Measure => ({
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: { period: "perSession", frequency },
});

async function logAt(
  app: TestApp,
  given: Awaited<ReturnType<typeof givenActiveSeason>>,
  day: number,
) {
  const result = await recordEntry(atInstant(app, localInstant(DAY(day))), given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    value: { kind: "quantity", value: "30" },
    clientRequestId: `r-${day}`,
  });
  expect(result.ok).toBe(true);
}

describe("score queries follow the season clock", () => {
  async function dailySeason() {
    const app = createTestApp({ now: localInstant(DAY(0)), timeZone: fixtureTimeZone });
    const given = await givenActiveSeason(app, reach(EVERY_DAY));
    for (const day of [0, 1, 2, 3, 4]) {
      await logAt(app, given, day);
    }
    const scoreAt = async (day: number) => {
      const result = await memberScore(atInstant(app, localInstant(DAY(day))), given.andrea, {
        seasonId: given.season.id,
      });
      if (!result.ok || result.value.kind !== "scored") throw new Error("expected a score");
      return result.value;
    };
    return { scoreAt };
  }

  it("mid-season: only the opportunities already closed count toward consistency", async () => {
    const { scoreAt } = await dailySeason();

    // Day 10: days 0-9 are closed. 5 logged of 10 counted.
    const score = await scoreAt(10);

    // 5 full-progress opportunities over the whole 28-day season: 5000 / 28 = 178.57.
    expect(score).toMatchObject({ points: 179, consistency: 50, idealCompletion: 50 });
  });

  it("after the season: every opportunity counts", async () => {
    const { scoreAt } = await dailySeason();

    const score = await scoreAt(40);

    expect(score).toMatchObject({ points: 179, consistency: 18, idealCompletion: 18 });
  });

  it("standings rank by what has closed so far: a week-bound commitment only counts after its week", async () => {
    const app = createTestApp({ now: localInstant(DAY(0)), timeZone: fixtureTimeZone });
    const given = await givenActiveSeason(app, reach(EVERY_DAY));
    await logAt(app, given, 0);
    for (const day of [0, 1, 2]) {
      const done = await recordEntry(atInstant(app, localInstant(DAY(day))), given.victor, {
        seasonId: given.season.id,
        commitmentId: given.victorCommitment,
        value: { kind: "done" },
        clientRequestId: `v-${day}`,
      });
      expect(done.ok).toBe(true);
    }
    const rowsAt = async (day: number) => {
      const result = await standings(atInstant(app, localInstant(DAY(day))), given.andrea, {
        seasonId: given.season.id,
      });
      if (!result.ok || result.value.kind !== "ranked") throw new Error("expected standings");
      return result.value.rows.map((row) => [row.memberId, row.rank, row.points]);
    };

    // Day 2: Victor's week 0 is still open, so he has nothing counted yet.
    expect(await rowsAt(2)).toEqual([
      ["member-andrea", 1, 36],
      ["member-victor", 2, 0],
    ]);
    // Day 10: week 0 closed with 3 of 3 sessions: one full week out of 4 = 250 points.
    expect(await rowsAt(10)).toEqual([
      ["member-victor", 1, 250],
      ["member-andrea", 2, 36],
    ]);
  });
});

describe("a season that started later than planned (B3)", () => {
  /** Nominal start Thu 2026-10-01, actual start Fri 2026-10-02; Andrea works Mondays only. */
  async function shiftedSeason() {
    const app = createTestApp({ now: localInstant(DAY(4)), timeZone: fixtureTimeZone });
    const given = await givenActiveSeason(app, reach({ kind: "specificDays", weekdays: [0] }));
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save(
        { ...given.season, nominalStart: DAY(0), actualStart: DAY(1) },
        given.season.version,
      );
      return { ok: true, value: undefined };
    });
    return { app, given };
  }

  it("takes the weekday of each opportunity from the ACTUAL start", async () => {
    const { app, given } = await shiftedSeason();

    // Clock Tue 2026-10-06 = day 4. The first Monday (10-05) is day 3 and is closed by then.
    // Counting weekdays from the nominal Thursday would place it on day 4, still open.
    const result = await memberScore(atInstant(app, localInstant(DAY(5))), given.andrea, {
      seasonId: given.season.id,
    });

    expect(result).toMatchObject({ value: { points: 0, consistency: 0 } });
  });
});

describe("the season's own time zone decides today", () => {
  it("scores a season in Pacific/Auckland whose local day has begun while UTC is still the day before", async () => {
    // 2026-10-01T12:00Z is 2026-10-02 01:00 in Auckland (UTC+13 in October) but 10-01 in UTC.
    const utcNoon = instant(epochDay(DAY(0)) * 86_400_000 + 12 * 3_600_000);
    const app = createTestApp({ now: utcNoon, timeZone: createIntlTimeZone() });
    const given = await givenActiveSeason(app, reach(EVERY_DAY));
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save(
        {
          ...given.season,
          timeZone: timeZoneId("Pacific/Auckland"),
          nominalStart: DAY(1),
          actualStart: DAY(1),
        },
        given.season.version,
      );
      return { ok: true, value: undefined };
    });

    const score = await memberScore(app, given.andrea, { seasonId: given.season.id });
    const ranking = await standings(app, given.andrea, { seasonId: given.season.id });

    expect(score).toMatchObject({ ok: true, value: { kind: "scored" } });
    expect(ranking).toMatchObject({ ok: true, value: { kind: "ranked" } });
  });
});
