import {
  type Entry,
  eq,
  fromInt,
  gt,
  type SeasonDay,
  scoreMember,
  seasonDay,
} from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import { commitmentToEngine } from "../commitment/to-engine.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { localDate } from "../time/local-date.ts";
import { recordEntry } from "./record-entry.ts";

// Season day 0 is Thursday 2026-10-01, so engine weekday 3 (Monday = 0).
// The commitment is scheduled Thursday (day 0) and Friday (day 1) only;
// day 2 (Saturday) is NOT a scheduled weekday.
const THURSDAY_FRIDAY: Measure = {
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: fromInt(10), ideal: fromInt(30) },
  schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [3, 4] } },
};
const day = (n: number) => localDate(`2026-10-${String(1 + n).padStart(2, "0")}`);

/** Records a 30-minute entry on each given opportunity day (on that day itself), then scores the season. */
async function pointsAfterRecording(days: readonly number[]) {
  const seed = createTestApp({ now: localInstant(day(0)), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(seed, THURSDAY_FRIDAY);
  for (const n of days) {
    const result = await recordEntry(atInstant(seed, localInstant(day(n))), given.andrea, {
      seasonId: given.season.id,
      commitmentId: given.andreaCommitment,
      value: { kind: "quantity", value: "30" },
      clientRequestId: `req-${n}`,
    });
    expect(result.ok).toBe(true);
  }
  const stored = await seed.uow.read((repos) => repos.entries.listBySeason(given.season.id));
  const entries: Entry[] = stored.map((entry) => ({
    commitmentId: entry.commitmentId,
    day: entry.day,
    recordedOn: entry.recordedOn,
    ...(entry.value.kind === "quantity"
      ? { kind: "quantity" as const, value: entry.value.value }
      : { kind: entry.value.kind }),
  }));
  const commitment = given.season.commitments[0];
  if (!commitment) throw new Error("fixture has no commitment");
  const today: SeasonDay = seasonDay(10);
  return scoreMember({
    season: { lengthWeeks: 4, startWeekday: 3 },
    commitments: [commitmentToEngine(commitment)],
    entries,
    pauses: [],
    today,
  }).points;
}

describe("recordEntry on an unscheduled weekday of a specificDays commitment", () => {
  it("is accepted and the engine counts it as a make-up for the week's earliest missing scheduled day", async () => {
    const none = await pointsAfterRecording([]);
    const makeUp = await pointsAfterRecording([2]);
    const scheduledDay = await pointsAfterRecording([0]);

    expect(gt(makeUp, none)).toBe(true);
    expect(eq(makeUp, scheduledDay)).toBe(true);
  });

  it("adds nothing once every scheduled day of that week already has an entry", async () => {
    const both = await pointsAfterRecording([0, 1]);
    const bothPlusExtra = await pointsAfterRecording([0, 1, 2]);

    expect(gt(both, await pointsAfterRecording([0]))).toBe(true);
    expect(eq(bothPlusExtra, both)).toBe(true);
  });
});
