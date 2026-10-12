import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { recordEntry } from "../entry/record-entry.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import {
  givenPauseWorld,
  type PauseWorld,
  type PauseWorldOptions,
} from "../testing/pause-fixtures.ts";
import { AUTO_APPROVE_AFTER_MS } from "./pause-request.ts";
import { type RequestPauseInput, requestPause } from "./request-pause.ts";

/** Day 0 is 2026-10-01; the season has 28 days (4 weeks), so the cap is 14 days per Commitment. */
async function setup(options: PauseWorldOptions = { withSofia: true }, today = 5) {
  const app = createTestApp({ now: localInstant(dayOf(today)), timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, options);
  return { app, world, today };
}

function input(world: PauseWorld, today: number, extra: Partial<RequestPauseInput> = {}) {
  return {
    seasonId: world.season.id,
    scope: { kind: "commitment", commitmentId: world.andreaCommitment },
    reason: "health",
    note: null,
    startDate: dayOf(today),
    endDate: null,
    ...extra,
  } satisfies RequestPauseInput;
}

const stored = (app: TestApp, world: PauseWorld) => app.pauses.listBySeason(world.season.id);

/** GIVEN an Andrea pause for her main Commitment, written straight to the store. */
function seedAndrea(
  app: TestApp,
  world: PauseWorld,
  pause: {
    start: number;
    end: number | "open";
    decision: "pending" | "approved" | "rejected";
    resumedOn?: number;
    commitment?: PauseWorld["andreaCommitment"];
  },
) {
  const decidedOn = seasonDay(pause.start);
  return app.pauses.seed(world.season.id, {
    memberId: world.circle.members[0]?.id ?? ("?" as never),
    commitmentId: pause.commitment ?? world.andreaCommitment,
    requestedOn: seasonDay(pause.start),
    startDay: seasonDay(pause.start),
    end: pause.end === "open" ? { kind: "open" } : { kind: "fixed", lastDay: seasonDay(pause.end) },
    decision:
      pause.decision === "pending"
        ? { kind: "pending" }
        : pause.decision === "approved"
          ? {
              kind: "approved",
              decidedOn,
              resumedOn: pause.resumedOn === undefined ? null : seasonDay(pause.resumedOn),
            }
          : { kind: "rejected", decidedOn },
  });
}

describe("requestPause: creating a request (PL-1..PL-7)", () => {
  it("PL-S1: creates one pending request that auto-approves exactly 48 h later", async () => {
    const { app, world } = await setup();

    const result = await requestPause(app, world.andrea, input(world, 5));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      status: "pending",
      reason: "health",
      requestedAt: app.clock.now(),
      requestedOn: 5,
      startDay: 5,
      end: { kind: "open" },
      decidedAt: null,
      decidedOn: null,
      version: 0,
      commitments: [{ commitmentId: world.andreaCommitment, resumedOn: null, resumedAt: null }],
      responses: [],
    });
    expect(result.value.autoApproveAt).toBe(app.clock.now() + AUTO_APPROVE_AFTER_MS);
    expect(await stored(app, world)).toEqual([result.value]);
  });

  it("PL-S1: the covered opportunity is on hold: an Entry for it is refused", async () => {
    const { app, world } = await setup();
    await requestPause(app, world.andrea, input(world, 5));

    const entry = await recordEntry(app, world.andrea, {
      seasonId: world.season.id,
      commitmentId: world.andreaCommitment,
      forDate: dayOf(5),
      value: { kind: "quantity", value: "30" },
      clientRequestId: "k1",
    });

    expect(entry).toEqual({ ok: false, error: { kind: "OpportunityOnHold" } });
  });

  it("keeps the trimmed-to-null note and stores a fixed end", async () => {
    const { app, world } = await setup();

    const result = await requestPause(
      app,
      world.andrea,
      input(world, 5, { note: "", endDate: dayOf(8), reason: "travel" }),
    );

    expect(result.ok && result.value).toMatchObject({
      note: null,
      reason: "travel",
      end: { kind: "fixed", lastDay: 8 },
    });
  });

  it("PL-S2: a start before today is PauseRetroactive and nothing is stored", async () => {
    const { app, world } = await setup();

    const result = await requestPause(app, world.andrea, input(world, 5, { startDate: dayOf(4) }));

    expect(result).toEqual({ ok: false, error: { kind: "PauseRetroactive" } });
    expect(await stored(app, world)).toEqual([]);
  });

  it("PL-S3: a fixed end on the last season day is accepted; one day later is PauseEndsAfterSeason", async () => {
    const { app, world } = await setup();
    const lastDay = dayOf(27);
    const afterLast = "2026-10-29" as typeof lastDay;

    const ok = await requestPause(
      app,
      world.andrea,
      input(world, 5, { startDate: lastDay, endDate: lastDay }),
    );
    expect(ok.ok).toBe(true);

    const { app: other, world: w2 } = await setup();
    const late = await requestPause(
      other,
      w2.andrea,
      input(w2, 5, { startDate: lastDay, endDate: afterLast }),
    );
    expect(late).toEqual({ ok: false, error: { kind: "PauseEndsAfterSeason" } });
  });

  it("PL-3: a start after the last season day is PauseEndsAfterSeason", async () => {
    const { app, world } = await setup();
    const afterLast = "2026-10-29" as ReturnType<typeof dayOf>;

    const result = await requestPause(app, world.andrea, input(world, 5, { startDate: afterLast }));

    expect(result).toEqual({ ok: false, error: { kind: "PauseEndsAfterSeason" } });
  });

  it("PL-3: an end before the start is PauseEndBeforeStart", async () => {
    const { app, world } = await setup();

    const result = await requestPause(
      app,
      world.andrea,
      input(world, 5, { startDate: dayOf(7), endDate: dayOf(6) }),
    );

    expect(result).toEqual({ ok: false, error: { kind: "PauseEndBeforeStart" } });
  });

  it("PL-S4: a season that is not active is SeasonNotActive", async () => {
    const { app, world } = await setup();
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save({ ...world.season, status: "closed", version: 5 }, 1);
      return { ok: true, value: undefined };
    });

    const result = await requestPause(app, world.andrea, input(world, 5));

    expect(result).toEqual({ ok: false, error: { kind: "SeasonNotActive" } });
  });

  it("an ended season (today past its last day) is SeasonNotActive", async () => {
    const { app, world } = await setup(undefined, 30);

    const result = await requestPause(app, world.andrea, input(world, 30));

    expect(result).toEqual({ ok: false, error: { kind: "SeasonNotActive" } });
  });

  it("rejects an unknown reason", async () => {
    const { app, world } = await setup();

    const result = await requestPause(app, world.andrea, input(world, 5, { reason: "vacation" }));

    expect(result).toEqual({ ok: false, error: { kind: "InvalidPauseReason" } });
  });

  it("rejects an unknown scope", async () => {
    const { app, world } = await setup();

    const result = await requestPause(
      app,
      world.andrea,
      input(world, 5, { scope: { kind: "some" } as never }),
    );

    expect(result).toEqual({ ok: false, error: { kind: "InvalidPauseScope" } });
  });

  it("rejects a note over 280 characters and one that cannot be stored", async () => {
    const { app, world } = await setup();

    const long = await requestPause(app, world.andrea, input(world, 5, { note: "x".repeat(281) }));
    const nul = await requestPause(app, world.andrea, input(world, 5, { note: "a\u0000b" }));

    expect(long).toEqual({ ok: false, error: { kind: "NoteTooLong" } });
    expect(nul).toEqual({ ok: false, error: { kind: "InvalidNote" } });
  });

  it("PL-4: only an active member, and only for their own Commitments", async () => {
    const { app, world } = await setup();

    const stranger = await requestPause(app, { userId: userId("user-nobody") }, input(world, 5));
    const foreign = await requestPause(
      app,
      world.andrea,
      input(world, 5, {
        scope: { kind: "commitment", commitmentId: world.victorCommitment },
      }),
    );

    expect(stranger).toEqual({ ok: false, error: { kind: "NotAMember" } });
    expect(foreign).toEqual({ ok: false, error: { kind: "CommitmentNotOwned" } });
  });

  it("an unknown season is SeasonNotFound", async () => {
    const { app, world } = await setup();

    const result = await requestPause(
      app,
      world.andrea,
      input(world, 5, { seasonId: "nope" as never }),
    );

    expect(result).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
  });

  it("PL-5: Todos expands to every Commitment of the actor in ONE request", async () => {
    const { app, world } = await setup({ withSofia: true, withReading: true });

    const result = await requestPause(
      app,
      world.andrea,
      input(world, 5, { scope: { kind: "all" }, endDate: dayOf(8) }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.commitments.map((c) => c.commitmentId)).toEqual([
      world.andreaCommitment,
      world.andreaReading,
    ]);
    expect(await stored(app, world)).toHaveLength(1);
  });

  it("PL-S5 / Q1: in a solo circle the request is approved immediately, decided today", async () => {
    const { app, world } = await setup({ solo: true });

    const result = await requestPause(app, world.andrea, input(world, 5));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      status: "approved",
      decidedAt: app.clock.now(),
      decidedOn: 5,
    });
    expect((await stored(app, world))[0]).toMatchObject({ status: "approved", decidedOn: 5 });
  });

  it("settle-first: a due request of someone else is persisted by this write", async () => {
    const { app, world } = await setup();
    const due = seedAndrea(app, world, { start: 0, end: 1, decision: "pending" });
    await app.uow.transaction(async ({ pauses }) => {
      await pauses.save(
        {
          ...due,
          requestedAt: localInstant(dayOf(1)),
          autoApproveAt: localInstant(dayOf(3)),
          version: 1,
        },
        0,
      );
      return { ok: true, value: undefined };
    });

    await requestPause(app, world.andrea, input(world, 5, { startDate: dayOf(8) }));

    const settled = (await stored(app, world)).find((r) => r.id === due.id);
    expect(settled).toMatchObject({
      status: "approved",
      decidedAt: localInstant(dayOf(3)),
      decidedOn: 3,
    });
  });
});

describe("requestPause: the cap (PL-23..PL-27, Q11)", () => {
  const TODAY = 12;

  it("PL-S19: pending days count and a rejection frees them", async () => {
    const { app, world } = await setup({ withSofia: true }, TODAY);
    seedAndrea(app, world, { start: 0, end: 9, decision: "approved" });
    seedAndrea(app, world, { start: 10, end: 11, decision: "pending" });

    const tooLong = await requestPause(
      app,
      world.andrea,
      input(world, TODAY, { endDate: dayOf(TODAY + 2) }),
    );
    expect(tooLong).toEqual({
      ok: false,
      error: {
        kind: "PauseCapExceeded",
        commitments: [
          { commitmentId: world.andreaCommitment, reason: "exceedsRemainingCap", remainingDays: 2 },
        ],
      },
    });

    const exact = await requestPause(
      app,
      world.andrea,
      input(world, TODAY, { endDate: dayOf(TODAY + 1) }),
    );
    expect(exact.ok).toBe(true);

    // A rejected request frees its days again.
    const { app: fresh, world: w2 } = await setup({ withSofia: true }, TODAY);
    seedAndrea(fresh, w2, { start: 0, end: 9, decision: "approved" });
    seedAndrea(fresh, w2, { start: 10, end: 11, decision: "rejected" });
    const freed = await requestPause(
      fresh,
      w2.andrea,
      input(w2, TODAY, { endDate: dayOf(TODAY + 3) }),
    );
    expect(freed.ok).toBe(true);
  });

  it("PL-S20: Todos is blocked as a whole and lists only the offending Commitments; nothing is stored", async () => {
    const { app, world } = await setup({ withSofia: true, withReading: true }, TODAY);
    seedAndrea(app, world, { start: 0, end: 11, decision: "approved" });

    const result = await requestPause(
      app,
      world.andrea,
      input(world, TODAY, { scope: { kind: "all" }, endDate: dayOf(TODAY + 4) }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "PauseCapExceeded",
        commitments: [
          { commitmentId: world.andreaCommitment, reason: "exceedsRemainingCap", remainingDays: 2 },
        ],
      },
    });
    expect(await stored(app, world)).toHaveLength(1); // only the seeded one

    const fits = await requestPause(
      app,
      world.andrea,
      input(world, TODAY, { scope: { kind: "all" }, endDate: dayOf(TODAY + 1) }),
    );
    expect(fits.ok && fits.value.commitments).toHaveLength(2);
  });

  it("PL-S23: with nothing left an open request fails with remainingDays 0", async () => {
    const { app, world } = await setup({ withSofia: true }, 14);
    seedAndrea(app, world, { start: 0, end: 13, decision: "approved" });

    const result = await requestPause(app, world.andrea, input(world, 14));

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "PauseCapExceeded",
        commitments: [
          { commitmentId: world.andreaCommitment, reason: "capExhausted", remainingDays: 0 },
        ],
      },
    });
  });
});

describe("requestPause: overlapping requests are forbidden (Q5)", () => {
  const TODAY = 12;

  it("PL-S24: a start inside an approved range overlaps; the day after its end is an extension", async () => {
    const { app, world } = await setup({ withSofia: true }, TODAY);
    seedAndrea(app, world, { start: 15, end: 21, decision: "approved" });

    const overlap = await requestPause(
      app,
      world.andrea,
      input(world, TODAY, { startDate: dayOf(19), endDate: dayOf(20) }),
    );
    expect(overlap).toEqual({
      ok: false,
      error: { kind: "PauseOverlaps", commitmentIds: [world.andreaCommitment] },
    });

    const extension = await requestPause(
      app,
      world.andrea,
      input(world, TODAY, { startDate: dayOf(22), endDate: dayOf(23) }),
    );
    expect(extension.ok).toBe(true);
  });

  it("PL-S24: a request that spans an existing one overlaps it too", async () => {
    const { app, world } = await setup({ withSofia: true }, TODAY);
    seedAndrea(app, world, { start: 15, end: 16, decision: "pending" });

    const result = await requestPause(
      app,
      world.andrea,
      input(world, TODAY, { startDate: dayOf(13), endDate: dayOf(20) }),
    );

    expect(result).toMatchObject({ ok: false, error: { kind: "PauseOverlaps" } });
  });

  it("PL-S25: a pending open request blocks anything starting on or after its start", async () => {
    const { app, world } = await setup({ withSofia: true }, TODAY);
    seedAndrea(app, world, { start: TODAY, end: "open", decision: "pending" });

    const result = await requestPause(
      app,
      world.andrea,
      input(world, TODAY, { startDate: dayOf(TODAY + 3), endDate: dayOf(TODAY + 4) }),
    );

    expect(result).toMatchObject({ ok: false, error: { kind: "PauseOverlaps" } });
  });

  it("PL-S26: a resumed open pause frees the days from its resume day", async () => {
    const { app, world } = await setup({ withSofia: true }, TODAY);
    seedAndrea(app, world, { start: 8, end: "open", decision: "approved", resumedOn: TODAY });

    const result = await requestPause(app, world.andrea, input(world, TODAY));

    expect(result.ok).toBe(true);
  });

  it("rejected and cancelled requests never overlap", async () => {
    const { app, world } = await setup({ withSofia: true }, TODAY);
    seedAndrea(app, world, { start: TODAY, end: TODAY + 3, decision: "rejected" });

    const result = await requestPause(
      app,
      world.andrea,
      input(world, TODAY, { endDate: dayOf(TODAY + 2) }),
    );

    expect(result.ok).toBe(true);
  });

  it("overlap is per Commitment: another Commitment of the same request span is free", async () => {
    const { app, world } = await setup({ withSofia: true, withReading: true }, TODAY);
    seedAndrea(app, world, { start: TODAY, end: TODAY + 3, decision: "approved" });

    const result = await requestPause(
      app,
      world.andrea,
      input(world, TODAY, {
        scope: { kind: "commitment", commitmentId: world.andreaReading },
        endDate: dayOf(TODAY + 2),
      }),
    );

    expect(result.ok).toBe(true);
  });
});
