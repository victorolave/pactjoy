import { expect, it } from "vitest";
import * as engine from "./index.ts";
import { buildDoneCommitment } from "./test-support/builders.ts";

it("exports opportunity counts but keeps the scoring walk internal", () => {
  const commitment = buildDoneCommitment("habit", 100);
  expect(
    engine.opportunityCounts(commitment, {
      season: { lengthWeeks: 4, startWeekday: 0 },
      commitments: [commitment],
      entries: [],
      pauses: [],
      today: engine.seasonDay(0),
    }),
  ).toEqual({ kept: 0, counted: 0, total: 12, perOpportunityPoints: engine.frac(250n, 3n) });
  expect(Object.keys(engine)).not.toContain("seasonSessions");
});
