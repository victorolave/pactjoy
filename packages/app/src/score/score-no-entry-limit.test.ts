import { fromInt } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
  SEASON_START,
} from "../testing/entry-fixtures.ts";
import { localDate } from "../time/local-date.ts";
import { memberScore } from "./member-score.query.ts";

const DAILY_LIMIT: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "limit", ideal: fromInt(30), tolerance: fromInt(60) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};

describe("memberScore: limit commitments", () => {
  it("ER-19: an opportunity with no entry scores 0, never the limit's full mark", async () => {
    const app = createTestApp({ now: localInstant(SEASON_START), timeZone: fixtureTimeZone });
    const given = await givenActiveSeason(app, DAILY_LIMIT);
    // The whole season is over and Andrea never logged anything.
    const after = atInstant(app, localInstant(localDate("2026-11-15")));

    const result = await memberScore(after, given.andrea, { seasonId: given.season.id });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "scored", points: 0, consistency: 0, idealCompletion: 0 },
    });
  });
});
