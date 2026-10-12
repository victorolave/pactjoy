import { describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { atInstant, fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import { afterHours, givenPauseWorld, type PauseWorld } from "../testing/pause-fixtures.ts";
import { requestPause } from "./request-pause.ts";
import { respondToPause } from "./respond-to-pause.ts";
import { settleDuePauses } from "./settle-due-pauses.ts";

const T0 = localInstant(dayOf(5));

async function givenTwoRequests() {
  const app = createTestApp({ now: T0, timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, { withSofia: true });
  const ask = (
    actor: PauseWorld["andrea"],
    commitmentId: PauseWorld["andreaCommitment"],
    at: TestApp,
  ) =>
    requestPause(at, actor, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId },
      reason: "work",
      note: null,
      startDate: dayOf(5),
      endDate: dayOf(6),
    });
  const first = await ask(world.andrea, world.andreaCommitment, app);
  const second = await ask(world.victor, world.victorCommitment, atInstant(app, afterHours(T0, 1)));
  if (!first.ok || !second.ok) throw new Error("fixture failed");
  return { app, world, first: first.value, second: second.value };
}

describe("settleDuePauses (PL-18, PL-19)", () => {
  it("PL-S16: persists every due request with its own deadline day, and a second run settles 0", async () => {
    const { app, first, second } = await givenTwoRequests();

    const run1 = await settleDuePauses(atInstant(app, localInstant(dayOf(10))), {});
    const afterFirst = [await app.pauses.get(first.id), await app.pauses.get(second.id)];
    const run2 = await settleDuePauses(atInstant(app, localInstant(dayOf(11))), {});
    const afterSecond = [await app.pauses.get(first.id), await app.pauses.get(second.id)];

    expect(run1).toEqual({ ok: true, value: { settled: 2 } });
    expect(run2).toEqual({ ok: true, value: { settled: 0 } });
    expect(afterFirst).toEqual(afterSecond);
    expect(afterFirst[0]).toMatchObject({
      status: "approved",
      decidedAt: first.autoApproveAt,
      decidedOn: 7,
    });
    expect(afterFirst[1]).toMatchObject({
      status: "approved",
      decidedAt: second.autoApproveAt,
      decidedOn: 7,
      version: 1,
    });
  });

  it("leaves requests that are not yet due untouched", async () => {
    const { app, first, second } = await givenTwoRequests();

    // After the first deadline (T0 + 48 h) but before the second (T0 + 49 h).
    const result = await settleDuePauses(atInstant(app, afterHours(T0, 48.5)), {});

    expect(result).toEqual({ ok: true, value: { settled: 1 } });
    expect((await app.pauses.get(first.id))?.status).toBe("approved");
    expect((await app.pauses.get(second.id))?.status).toBe("pending");
  });

  it("PL-S9: a standing reject becomes rejected at the deadline", async () => {
    const { app, world, first } = await givenTwoRequests();
    await respondToPause(atInstant(app, afterHours(T0, 2)), world.sofia, {
      pauseRequestId: first.id,
      decision: "reject",
    });

    await settleDuePauses(atInstant(app, localInstant(dayOf(10))), {});

    expect(await app.pauses.get(first.id)).toMatchObject({ status: "rejected", decidedOn: 7 });
  });

  it("does nothing when there is nothing due", async () => {
    const app = createTestApp({ now: T0, timeZone: fixtureTimeZone });

    expect(await settleDuePauses(app, {})).toEqual({ ok: true, value: { settled: 0 } });
  });
});
