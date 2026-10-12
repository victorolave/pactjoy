import { describe, expect, it } from "vitest";
import { recordEntry } from "../entry/record-entry.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { atInstant, END_OF_DAY, fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import { afterHours, givenPauseWorld, type PauseWorld } from "../testing/pause-fixtures.ts";
import { today } from "../today/today.query.ts";
import { cancelPauseRequest } from "./cancel-pause-request.ts";
import { requestPause } from "./request-pause.ts";
import { respondToPause } from "./respond-to-pause.ts";

/** Andrea asks at noon of day 5 for her Commitment, from that day on; auto-approval at noon of day 7. */
const T0 = localInstant(dayOf(5));
const DEADLINE = afterHours(T0, 48);

async function givenRequest(scope: "one" | "all" = "one") {
  const app = createTestApp({ now: T0, timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, { withSofia: true, withReading: scope === "all" });
  const created = await requestPause(app, world.andrea, {
    seasonId: world.season.id,
    scope:
      scope === "all"
        ? { kind: "all" }
        : { kind: "commitment", commitmentId: world.andreaCommitment },
    reason: "travel",
    note: null,
    startDate: dayOf(5),
    endDate: null,
  });
  if (!created.ok) throw new Error(`fixture failed: ${created.error.kind}`);
  return { app, world, request: created.value };
}

const cancel = (
  app: TestApp,
  actor: PauseWorld["andrea"],
  id: Awaited<ReturnType<typeof givenRequest>>["request"]["id"],
  at = app.clock.now(),
) => cancelPauseRequest(atInstant(app, at), actor, { pauseRequestId: id });

const recordDay5 = (app: TestApp, world: PauseWorld, at: ReturnType<typeof localInstant>) =>
  recordEntry(atInstant(app, at), world.andrea, {
    seasonId: world.season.id,
    commitmentId: world.andreaCommitment,
    forDate: dayOf(5),
    value: { kind: "quantity", value: "30" },
    clientRequestId: `k-${at}`,
  });

describe("cancelPauseRequest (PL-20..PL-22, Q2)", () => {
  it("cancels a pending request, decided on the cancel day", async () => {
    const { app, world, request } = await givenRequest();
    const at = localInstant(dayOf(6), 16 * 3_600_000);

    const result = await cancel(app, world.andrea, request.id, at);

    expect(result.ok && result.value).toMatchObject({
      status: "cancelled",
      decidedAt: at,
      decidedOn: 6,
      version: 1,
    });
    expect((await app.pauses.get(request.id))?.status).toBe("cancelled");
  });

  it("PL-S17: a cancel extends the grace of the covered day to the end of the day after the cancel", async () => {
    const { app, world, request } = await givenRequest();
    await cancel(app, world.andrea, request.id, localInstant(dayOf(6), 16 * 3_600_000));

    // Day 5 would close at the end of day 6; the cancel on day 6 keeps it open through day 7.
    const open = await recordDay5(app, world, localInstant(dayOf(7), END_OF_DAY));
    const { app: late, world: w2, request: r2 } = await givenRequest();
    await cancel(late, w2.andrea, r2.id, localInstant(dayOf(6), 16 * 3_600_000));
    const closed = await recordDay5(late, w2, localInstant(dayOf(8), 0));

    expect(open.ok).toBe(true);
    expect(closed).toEqual({ ok: false, error: { kind: "WindowClosed" } });
  });

  it("TR-S3: after a cancel, the covered day shows up in pending-yesterday until the end of the day after the cancel", async () => {
    const { app, world, request } = await givenRequest();
    const todayAt = (day: number) =>
      today(atInstant(app, localInstant(dayOf(day), 9 * 3_600_000)), world.andrea);
    const listed = async (day: number) => {
      const view = await todayAt(day);
      if (view.state !== "active") throw new Error(`state ${view.state}`);
      return view.pendingYesterday.map((item) => item.forDate);
    };

    // Pending, yesterday (day 5) is on hold: nothing to register.
    expect(await listed(6)).toEqual([]);

    await cancel(app, world.andrea, request.id, localInstant(dayOf(6), 16 * 3_600_000));

    expect(await listed(6)).toEqual([dayOf(5)]);
  });

  it("PL-S18: a cancel at the auto-approval instant finds it approved and is refused", async () => {
    const { app, world, request } = await givenRequest();

    const result = await cancel(app, world.andrea, request.id, DEADLINE);

    expect(result).toEqual({ ok: false, error: { kind: "PauseAlreadyDecided" } });
  });

  it("a decided request cannot be cancelled", async () => {
    const { app, world, request } = await givenRequest();
    await respondToPause(atInstant(app, afterHours(T0, 1)), world.victor, {
      pauseRequestId: request.id,
      decision: "approve",
    });
    await respondToPause(atInstant(app, afterHours(T0, 2)), world.sofia, {
      pauseRequestId: request.id,
      decision: "approve",
    });

    const result = await cancel(app, world.andrea, request.id, afterHours(T0, 3));

    expect(result).toEqual({ ok: false, error: { kind: "PauseAlreadyDecided" } });
  });

  it("only the requester can cancel", async () => {
    const { app, world, request } = await givenRequest();

    const result = await cancel(app, world.victor, request.id);

    expect(result).toEqual({ ok: false, error: { kind: "NotPauseRequester" } });
  });

  it("a stranger or an unknown id gets PauseRequestNotFound", async () => {
    const { app, world, request } = await givenRequest();

    const stranger = await cancel(app, { userId: userId("user-nobody") }, request.id);
    const unknown = await cancel(app, world.andrea, "nope" as never);

    expect(stranger).toEqual({ ok: false, error: { kind: "PauseRequestNotFound" } });
    expect(unknown).toEqual({ ok: false, error: { kind: "PauseRequestNotFound" } });
  });

  it("PL-20: Todos is cancelled as a whole", async () => {
    const { app, world, request } = await givenRequest("all");

    const result = await cancel(app, world.andrea, request.id, afterHours(T0, 5));

    expect(result.ok && result.value.commitments).toHaveLength(2);
    expect(result.ok && result.value.status).toBe("cancelled");
  });
});
