import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { PauseRequestRecord } from "../pause/pause-request.ts";
import { pauseRequestId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { pauseRequestFixture } from "../testing/builders.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { deleteEntry } from "./delete-entry.ts";
import { editEntry } from "./edit-entry.ts";
import { recordEntry } from "./record-entry.ts";

/** Season day 0 is 2026-10-01, zone UTC-3. Andrea's Pause starts on day 5 and is open. */
async function setup() {
  const app = createTestApp({ now: localInstant(dayOf(5)), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, PER_DAY_REACH);
  return { app, given };
}

function approved(
  given: Awaited<ReturnType<typeof setup>>["given"],
  extra: Partial<PauseRequestRecord> = {},
) {
  return pauseRequestFixture({
    id: pauseRequestId("pause-a"),
    seasonId: given.season.id,
    memberId: given.circle.members[0]?.id ?? ("?" as never),
    requestedAt: localInstant(dayOf(5), 0),
    requestedOn: seasonDay(5),
    startDay: seasonDay(5),
    commitments: [{ commitmentId: given.andreaCommitment, resumedOn: null, resumedAt: null }],
    status: "approved",
    decidedAt: localInstant(dayOf(5), 1),
    decidedOn: seasonDay(5),
    version: 1,
    ...extra,
  });
}

const record = (
  app: Awaited<ReturnType<typeof setup>>["app"],
  given: Awaited<ReturnType<typeof setup>>["given"],
  day: number,
  at = app.clock.now(),
  key = `k${day}`,
) =>
  recordEntry(atInstant(app, at), given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    forDate: dayOf(day),
    value: { kind: "quantity", value: "30" },
    clientRequestId: key,
  });

describe("an Entry on an opportunity covered by an approved Pause (owner decision, 2026-10-12)", () => {
  it("recordEntry refuses it with OpportunityPaused, distinct from OpportunityOnHold", async () => {
    const { app, given } = await setup();
    await app.pauses.save(approved(given), null);

    expect(await record(app, given, 5)).toEqual({
      ok: false,
      error: { kind: "OpportunityPaused" },
    });
  });

  it("a day before the Pause starts is still accepted", async () => {
    const { app, given } = await setup();
    await app.pauses.save(approved(given), null);

    expect((await record(app, given, 4)).ok).toBe(true);
  });

  it("from resumedOn on, that day included, the opportunity is active again", async () => {
    const { app, given } = await setup();
    await app.pauses.save(
      approved(given, {
        commitments: [
          {
            commitmentId: given.andreaCommitment,
            resumedOn: seasonDay(5),
            resumedAt: localInstant(dayOf(5), 2),
          },
        ],
      }),
      null,
    );

    expect((await record(app, given, 5)).ok).toBe(true);
  });

  it("a pending request stays OpportunityOnHold", async () => {
    const { app, given } = await setup();
    await app.pauses.save(
      approved(given, { status: "pending", decidedAt: null, decidedOn: null, version: 0 }),
      null,
    );

    expect(await record(app, given, 5)).toEqual({
      ok: false,
      error: { kind: "OpportunityOnHold" },
    });
  });

  it("editEntry refuses it, but deleteEntry is allowed", async () => {
    const { app, given } = await setup();
    const recorded = await record(app, given, 5);
    if (!recorded.ok) throw new Error("fixture failed");
    await app.pauses.save(approved(given), null);
    const id = recorded.value.entry.id;

    const edit = await editEntry(app, given.andrea, {
      entryId: id,
      value: { kind: "quantity", value: "40" },
      note: null,
    });
    const del = await deleteEntry(app, given.andrea, { entryId: id });

    expect(edit).toEqual({ ok: false, error: { kind: "OpportunityPaused" } });
    expect(del.ok).toBe(true);
  });
});
