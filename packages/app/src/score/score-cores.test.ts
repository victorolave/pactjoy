import { fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
import { localDate } from "../time/local-date.ts";
import { memberScore, memberScoreView } from "./member-score.query.ts";
import { scoreContextOf } from "./score-context.ts";
import { standings, standingsView } from "./standings.query.ts";

const DAILY_REACH: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};

async function setup() {
  const app = createTestApp({
    now: localInstant(localDate("2026-10-01")),
    timeZone: fixtureTimeZone,
  });
  const given = await givenActiveSeason(app, DAILY_REACH, "active");
  const recorded = await recordEntry(app, given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    value: { kind: "quantity", value: "30" },
    clientRequestId: "r-30",
  });
  expect(recorded.ok).toBe(true);
  return { app, given };
}

describe("score cores composed inside ONE read (SQ-S9, SQ-R10)", () => {
  it("SQ-S9: memberScoreView and standingsView over pre-loaded data equal the standalone queries", async () => {
    const { app, given } = await setup();
    const standalone = await memberScore(app, given.andrea, { seasonId: given.season.id });
    const standaloneStandings = await standings(app, given.andrea, { seasonId: given.season.id });

    const composed = await app.uow.read(async (repos) => {
      const season = await repos.seasons.get(given.season.id);
      const circle = season ? await repos.circles.get(season.circleId) : null;
      if (!season || !circle) throw new Error("fixture season missing");
      const context = scoreContextOf(app, season, circle, given.andrea);
      if (!context.ok || context.value.start === null) throw new Error("expected a started season");
      const started = { ...context.value, start: context.value.start };
      const data = {
        entries: await repos.entries.listBySeason(season.id),
        pauses: await repos.pauses.listBySeason(season.id),
      };
      return {
        score: memberScoreView(started, data, started.viewer),
        standings: standingsView(started, data),
      };
    });

    expect(standalone).toEqual({ ok: true, value: composed.score });
    expect(standaloneStandings).toEqual({ ok: true, value: composed.standings });
  });

  it("scoreContextOf is synchronous and rejects a non-member", async () => {
    const { app, given } = await setup();
    const result = await app.uow.read(async (repos) => {
      const season = await repos.seasons.get(given.season.id);
      const circle = season ? await repos.circles.get(season.circleId) : null;
      if (!season || !circle) throw new Error("fixture season missing");
      return scoreContextOf(app, season, circle, { userId: userId("user-outsider") });
    });
    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });
});
