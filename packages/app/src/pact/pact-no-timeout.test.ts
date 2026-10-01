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
import { instant } from "../time/instant.ts";
import { approvePact } from "./approve-pact.ts";

const MEASURE: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};
const DAY_MS = 86_400_000;

describe("the pact never times out", () => {
  it("PA-8: a pact left open for 90 days stays open, with nobody auto-approved (only a PAUSE auto-approves, after 48 h)", async () => {
    const app = createTestApp({ now: localInstant(SEASON_START), timeZone: fixtureTimeZone });
    const given = await givenActiveSeason(app, MEASURE, "pactOpen");
    const later = atInstant(app, instant(localInstant(SEASON_START) + 90 * DAY_MS));

    // Only Andrea acts, 90 days on; Victor never does.
    const approved = await approvePact(later, given.andrea, {
      seasonId: given.season.id,
      expectedPactRevision: given.season.pactRevision,
    });

    expect(approved.ok).toBe(true);
    const stored = await app.seasons.get(given.season.id);
    expect(stored?.status).toBe("pactOpen");
    expect(stored?.actualStart).toBeNull();
    expect(stored?.approvals.map((approval) => approval.memberId)).toEqual([
      given.circle.members[0]?.id,
    ]);
  });
});
