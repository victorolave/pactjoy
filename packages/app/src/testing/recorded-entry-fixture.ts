import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { createTestApp } from "./app-harness.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "./entry-fixtures.ts";
import { dayOf } from "./entry-measures.ts";

/** An active season where Andrea (commitment with `measure`) recorded 30, note "original", for `forDay` on `recordedOnDay`. */
export async function givenRecordedEntry(
  measure: Measure,
  recordedOnDay: number,
  forDay = recordedOnDay,
) {
  const app = createTestApp({
    now: localInstant(dayOf(recordedOnDay)),
    timeZone: fixtureTimeZone,
  });
  const given = await givenActiveSeason(app, measure);
  const recorded = await recordEntry(app, given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    forDate: dayOf(forDay),
    value: { kind: "quantity", value: "30" },
    note: "original",
    clientRequestId: "req-1",
  });
  if (!recorded.ok) {
    throw new Error(`setup: recordEntry failed with ${recorded.error.kind}`);
  }
  return { app, given, entry: recorded.value.entry };
}
