import { describe, expect, it } from "vitest";
import { recordEntry } from "../entry/record-entry.ts";
import { standings } from "../score/standings.query.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { atInstant, fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import { afterHours, givenPauseWorld, type PauseWorld } from "../testing/pause-fixtures.ts";
import { instant } from "../time/instant.ts";
import { myPauseRequests } from "./my-pause-requests.query.ts";
import { requestPause } from "./request-pause.ts";
import { respondToPause } from "./respond-to-pause.ts";

const T0 = localInstant(dayOf(5));
const DEADLINE = afterHours(T0, 48);

async function givenRequest(options: { sofia?: boolean; end?: number | null } = {}) {
  const app = createTestApp({ now: T0, timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, { withSofia: options.sofia ?? true });
  const created = await requestPause(app, world.andrea, {
    seasonId: world.season.id,
    scope: { kind: "commitment", commitmentId: world.andreaCommitment },
    reason: "health",
    note: null,
    startDate: dayOf(5),
    endDate: options.end === undefined || options.end === null ? null : dayOf(options.end),
  });
  if (!created.ok) throw new Error("fixture failed");
  return { app, world, request: created.value };
}

const read = (app: TestApp, actor: PauseWorld["andrea"], at = app.clock.now()) =>
  myPauseRequests(atInstant(app, at), actor);

describe("myPauseRequests (PA-2, PA-8)", () => {
  it("is total: no circle gives empty lists", async () => {
    const app = createTestApp({ now: T0, timeZone: fixtureTimeZone });

    expect(await myPauseRequests(app, { userId: userId("user-nobody") })).toEqual({
      seasonId: null,
      mine: [],
      awaitingMe: [],
      budgets: [],
      redistributed: null,
    });
  });

  it("is total: a circle without a started season gives empty lists", async () => {
    const app = createTestApp({ now: T0, timeZone: fixtureTimeZone });
    const world = await givenPauseWorld(app, {});
    await app.uow.transaction(async ({ seasons }) => {
      await seasons.save(
        {
          ...world.season,
          status: "pactOpen",
          actualStart: null,
          version: world.season.version + 1,
        },
        world.season.version,
      );
      return { ok: true, value: undefined };
    });

    const view = await read(app, world.andrea);

    expect(view).toMatchObject({ seasonId: null, mine: [], awaitingMe: [], budgets: [] });
  });

  it("lists my requests, and the pending ones of others awaiting my answer", async () => {
    const { app, world, request } = await givenRequest();

    const mine = await read(app, world.andrea);
    const victor = await read(app, world.victor);

    expect(mine.seasonId).toBe(world.season.id);
    expect(mine.mine).toEqual([request]);
    expect(mine.awaitingMe).toEqual([]);
    expect(victor.mine).toEqual([]);
    expect(victor.awaitingMe).toEqual([{ request, myResponse: null }]);
  });

  it("an answered request stays in the approver's list with their current answer, until it is decided", async () => {
    const { app, world, request } = await givenRequest();
    await respondToPause(atInstant(app, afterHours(T0, 1)), world.victor, {
      pauseRequestId: request.id,
      decision: "reject",
    });

    const pending = await read(app, world.victor, afterHours(T0, 2));
    expect(pending.awaitingMe.map((a) => a.myResponse)).toEqual(["reject"]);

    await respondToPause(atInstant(app, afterHours(T0, 3)), world.sofia, {
      pauseRequestId: request.id,
      decision: "approve",
    });
    const decided = await read(app, world.victor, afterHours(T0, 4));
    expect(decided.awaitingMe).toEqual([]);
    expect(decided.mine).toEqual([]);
  });

  it("PA-8: reports the effective status at the clock with no prior write, and never writes", async () => {
    const { app, world, request } = await givenRequest();

    const before = await read(app, world.andrea, instant(DEADLINE - 60_000));
    const after = await read(app, world.andrea, DEADLINE);

    expect(before.mine[0]?.status).toBe("pending");
    expect(after.mine[0]).toMatchObject({ status: "approved", decidedAt: DEADLINE, decidedOn: 7 });
    expect(await app.pauses.get(request.id)).toEqual(request);
    // An approver no longer sees it as awaiting once it is effectively decided.
    expect((await read(app, world.victor, DEADLINE)).awaitingMe).toEqual([]);
  });

  it("budgets: cap, used and remaining days per own Commitment, pending counted through today", async () => {
    const { app, world } = await givenRequest();

    const view = await read(app, world.andrea, localInstant(dayOf(8)));

    expect(view.budgets).toEqual([
      { commitmentId: world.andreaCommitment, cap: 14, usedDays: 4, remainingDays: 10 },
    ]);
  });

  it("a rejected request frees its days in the budget", async () => {
    const { app, world, request } = await givenRequest({ sofia: false });
    await respondToPause(atInstant(app, afterHours(T0, 1)), world.victor, {
      pauseRequestId: request.id,
      decision: "reject",
    });

    const view = await read(app, world.andrea, localInstant(dayOf(8)));

    expect(view.budgets[0]).toMatchObject({ usedDays: 0, remainingDays: 14 });
  });
});

describe("myPauseRequests: points redistributed (D11, TR-5)", () => {
  async function givenApprovedWithEntries() {
    const { app, world, request } = await givenRequest({ sofia: false, end: 14 });
    // Andrea did the habit fully on days 0..4, before asking.
    for (let day = 0; day <= 4; day += 1) {
      const recorded = await recordEntry(atInstant(app, localInstant(dayOf(day))), world.andrea, {
        seasonId: world.season.id,
        commitmentId: world.andreaCommitment,
        forDate: dayOf(day),
        value: { kind: "quantity", value: "30" },
        clientRequestId: `e${day}`,
      });
      if (!recorded.ok) throw new Error(`entry ${day} failed`);
    }
    await respondToPause(atInstant(app, afterHours(T0, 1)), world.victor, {
      pauseRequestId: request.id,
      decision: "approve",
    });
    return { app, world, request };
  }

  it("is null while nothing was approved", async () => {
    const { app, world } = await givenRequest();

    expect((await read(app, world.andrea)).redistributed).toBeNull();
  });

  it("compares the score with and without the latest approved request, rounded once", async () => {
    const { app, world, request } = await givenApprovedWithEntries();

    const view = await read(app, world.andrea, localInstant(dayOf(6)));

    expect(view.redistributed).not.toBeNull();
    const r = view.redistributed;
    if (!r) return;
    expect(r.pauseRequestId).toBe(request.id);
    // Paused days leave the denominator, so the same effort is worth more.
    expect(r.total.after).toBeGreaterThan(r.total.before);
    expect(r.commitments).toEqual([
      { commitmentId: world.andreaCommitment, before: r.total.before, after: r.total.after },
    ]);
  });

  it("is null for someone whose own request was not approved", async () => {
    const { app, world } = await givenApprovedWithEntries();

    expect((await read(app, world.victor, localInstant(dayOf(6)))).redistributed).toBeNull();
  });
});

describe("scoring reads use the effective decision without a job (SR-S3)", () => {
  it("standings read one minute before and at the deadline never need a settle", async () => {
    const { app, world } = await givenRequest();
    const rows = async (at: ReturnType<typeof instant>) => {
      const result = await standings(atInstant(app, at), world.andrea, {
        seasonId: world.season.id,
      });
      if (!result.ok || result.value.kind !== "ranked") throw new Error("standings failed");
      return result.value.rows;
    };

    const justBefore = await rows(instant(DEADLINE - 60_000));
    const atDeadline = await rows(DEADLINE);

    // Held then paused: the days leave the average either way, so the ranking is unchanged.
    expect(atDeadline).toEqual(justBefore);
  });
});
