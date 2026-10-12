import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import type { PauseRequestRecord } from "../pause/pause-request.ts";
import { pauseRequestId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { pauseRequestFixture } from "../testing/builders.ts";
import {
  atInstant,
  END_OF_DAY,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH, WEEKLY_TOTAL } from "../testing/entry-measures.ts";
import { deleteEntry } from "./delete-entry.ts";
import { editEntry } from "./edit-entry.ts";
import { recordEntry } from "./record-entry.ts";

/**
 * gracePeriod wiring (EW-1..EW-5): the Entry window follows the Commitment's
 * effective pause requests. Season day 0 is 2026-10-01, fixed zone UTC-3.
 */
async function setup(measure: Measure = PER_DAY_REACH) {
  const app = createTestApp({ now: localInstant(dayOf(5)), timeZone: fixtureTimeZone });
  const given = await givenActiveSeason(app, measure);
  return { app, given };
}

/** Andrea's request, made at noon on day 5 and starting that day; override to decide it. */
function request(
  given: Awaited<ReturnType<typeof setup>>["given"],
  extra: Partial<PauseRequestRecord> = {},
) {
  return pauseRequestFixture({
    id: pauseRequestId("pause-a"),
    seasonId: given.season.id,
    memberId: given.circle.members[0]?.id ?? ("?" as never),
    requestedAt: localInstant(dayOf(5)),
    requestedOn: seasonDay(5),
    startDay: seasonDay(5),
    end: { kind: "fixed", lastDay: seasonDay(5) },
    commitments: [{ commitmentId: given.andreaCommitment, resumedOn: null, resumedAt: null }],
    ...extra,
  });
}

const rejectedOnDay7 = (given: Awaited<ReturnType<typeof setup>>["given"]) =>
  request(given, {
    status: "rejected",
    decidedAt: localInstant(dayOf(7)),
    decidedOn: seasonDay(7),
    version: 1,
  });

const recordFor = (
  app: TestApp,
  given: Awaited<ReturnType<typeof setup>>["given"],
  forDay: number,
  at: ReturnType<typeof localInstant>,
  key = "k",
) =>
  recordEntry(atInstant(app, at), given.andrea, {
    seasonId: given.season.id,
    commitmentId: given.andreaCommitment,
    forDate: dayOf(forDay),
    value: { kind: "quantity", value: "30" },
    clientRequestId: key,
  });

describe("recordEntry: a rejection extends the window (EW-S1, EW-S2)", () => {
  it("EW-S1: after a rejection decided on day 7, an Entry for day 5 is accepted through the end of day 8", async () => {
    const { app, given } = await setup();
    await app.pauses.save(rejectedOnDay7(given), null);

    const open = await recordFor(app, given, 5, localInstant(dayOf(8), END_OF_DAY));
    expect(open.ok).toBe(true);
  });

  it("EW-S1: and is closed from the first moment of day 9", async () => {
    const { app, given } = await setup();
    await app.pauses.save(rejectedOnDay7(given), null);

    const closed = await recordFor(app, given, 5, localInstant(dayOf(9), 0));
    expect(closed).toEqual({ ok: false, error: { kind: "WindowClosed" } });
  });

  it("EW-S2: with no request the same Entry is refused after the normal deadline (end of day 6)", async () => {
    const { app, given } = await setup();
    expect((await recordFor(app, given, 5, localInstant(dayOf(6), END_OF_DAY))).ok).toBe(true);
    const { app: other, given: g2 } = await setup();
    expect(await recordFor(other, g2, 5, localInstant(dayOf(7), 0))).toEqual({
      ok: false,
      error: { kind: "WindowClosed" },
    });
  });

  it("PL-S17: a cancelled request extends exactly like a rejection, from the cancel day", async () => {
    const { app, given } = await setup();
    await app.pauses.save(
      request(given, {
        status: "cancelled",
        decidedAt: localInstant(dayOf(7)),
        decidedOn: seasonDay(7),
        version: 1,
      }),
      null,
    );
    expect((await recordFor(app, given, 5, localInstant(dayOf(8), END_OF_DAY))).ok).toBe(true);
    expect(await recordFor(app, given, 5, localInstant(dayOf(9), 0), "k2")).toMatchObject({
      ok: false,
      error: { kind: "WindowClosed" },
    });
  });

  it("EW-5: an approved request never extends the window", async () => {
    const { app, given } = await setup();
    await app.pauses.save(
      request(given, {
        status: "approved",
        decidedAt: localInstant(dayOf(7)),
        decidedOn: seasonDay(7),
        version: 1,
      }),
      null,
    );
    expect(await recordFor(app, given, 5, localInstant(dayOf(7), 0))).toEqual({
      ok: false,
      error: { kind: "WindowClosed" },
    });
  });

  it("a week-bound opportunity's whole week window extends with the rejection", async () => {
    const { app, given } = await setup(WEEKLY_TOTAL);
    // Week 0 normally closes after day 7; a rejection decided on day 8 moves it to day 9.
    await app.pauses.save(
      request(given, {
        startDay: seasonDay(3),
        end: { kind: "fixed", lastDay: seasonDay(3) },
        status: "rejected",
        decidedAt: localInstant(dayOf(8)),
        decidedOn: seasonDay(8),
        version: 1,
      }),
      null,
    );
    expect((await recordFor(app, given, 1, localInstant(dayOf(9), END_OF_DAY))).ok).toBe(true);
  });
});

describe("recordEntry: an opportunity on hold refuses new Entries (EW-4)", () => {
  it("is OpportunityOnHold while the request covering it is pending", async () => {
    const { app, given } = await setup();
    await app.pauses.save(request(given, { end: { kind: "fixed", lastDay: seasonDay(6) } }), null);
    expect(await recordFor(app, given, 5, localInstant(dayOf(5), END_OF_DAY))).toEqual({
      ok: false,
      error: { kind: "OpportunityOnHold" },
    });
  });

  it("does not touch a day the pending request does not cover", async () => {
    const { app, given } = await setup();
    await app.pauses.save(request(given), null);
    expect((await recordFor(app, given, 4, localInstant(dayOf(5), END_OF_DAY))).ok).toBe(true);
  });

  it("EW-S4: the write clock decides — refused a millisecond before the auto-approval, accepted at it", async () => {
    const { app, given } = await setup();
    const pending = request(given, { end: { kind: "fixed", lastDay: seasonDay(6) } });
    await app.pauses.save(pending, null);
    // Auto-approves at noon on day 7, when day 6 is still inside its own window (deadline day 7).
    const justBefore = await recordFor(app, given, 6, localInstant(dayOf(7), 12 * 3_600_000 - 1));
    expect(justBefore).toEqual({ ok: false, error: { kind: "OpportunityOnHold" } });

    const atDeadline = await recordFor(app, given, 6, localInstant(dayOf(7)), "k2");
    expect(atDeadline.ok).toBe(true);
  });
});

describe("editEntry / deleteEntry: the same pause-aware window", () => {
  async function withEntryOnDay5() {
    const { app, given } = await setup();
    const recorded = await recordFor(app, given, 5, localInstant(dayOf(5)));
    if (!recorded.ok) throw new Error("setup failed");
    return { app, given, id: recorded.value.entry.id };
  }

  it("a rejection keeps an edit open through the end of decidedOn + 1, and closes it after", async () => {
    const { app, given, id } = await withEntryOnDay5();
    await app.pauses.save(rejectedOnDay7(given), null);
    const edit = (at: ReturnType<typeof localInstant>) =>
      editEntry(atInstant(app, at), given.andrea, {
        entryId: id,
        value: { kind: "quantity", value: "40" },
        note: null,
      });

    expect((await edit(localInstant(dayOf(8), END_OF_DAY))).ok).toBe(true);
    expect(await edit(localInstant(dayOf(9), 0))).toMatchObject({
      ok: false,
      error: { kind: "WindowClosed" },
    });
  });

  it("a rejection keeps a delete open through the end of decidedOn + 1, and closes it after", async () => {
    const { app, given, id } = await withEntryOnDay5();
    await app.pauses.save(rejectedOnDay7(given), null);

    expect(
      await deleteEntry(atInstant(app, localInstant(dayOf(9), 0)), given.andrea, { entryId: id }),
    ).toMatchObject({ ok: false, error: { kind: "WindowClosed" } });
    expect(
      (
        await deleteEntry(atInstant(app, localInstant(dayOf(8), END_OF_DAY)), given.andrea, {
          entryId: id,
        })
      ).ok,
    ).toBe(true);
  });

  it("without a request the edit closes after day 6", async () => {
    const { app, given, id } = await withEntryOnDay5();
    expect(
      await editEntry(atInstant(app, localInstant(dayOf(7), 0)), given.andrea, {
        entryId: id,
        value: { kind: "quantity", value: "40" },
        note: null,
      }),
    ).toMatchObject({ ok: false, error: { kind: "WindowClosed" } });
  });
});
