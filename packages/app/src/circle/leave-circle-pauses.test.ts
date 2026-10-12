import { describe, expect, it } from "vitest";
import { requestPause } from "../pause/request-pause.ts";
import { respondToPause } from "../pause/respond-to-pause.ts";
import { memberScore } from "../score/member-score.query.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { atInstant, fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import { afterHours, givenPauseWorld, type PauseWorld } from "../testing/pause-fixtures.ts";
import { leaveCircle } from "./leave-circle.ts";

/** Andrea asks at noon of day 5; auto-approval would be at noon of day 7. */
const T0 = localInstant(dayOf(5));

async function givenPending(options: { sofia: boolean }) {
  const app = createTestApp({ now: T0, timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, { withSofia: options.sofia });
  const created = await requestPause(app, world.andrea, {
    seasonId: world.season.id,
    scope: { kind: "commitment", commitmentId: world.andreaCommitment },
    reason: "work",
    note: null,
    startDate: dayOf(5),
    endDate: null,
  });
  if (!created.ok) throw new Error("fixture failed");
  return { app, world, request: created.value };
}

const leave = (
  app: TestApp,
  actor: PauseWorld["andrea"],
  world: PauseWorld,
  at: ReturnType<typeof localInstant>,
) => leaveCircle(atInstant(app, at), actor, { circleId: world.circle.id });

describe("leaveCircle during an active season: pause requests (D12, PL-9, PL-36)", () => {
  it("an approver leaving shrinks the approver set; with another approver silent it stays pending", async () => {
    const { app, world, request } = await givenPending({ sofia: true });

    await leave(app, world.victor, world, afterHours(T0, 5));

    expect((await app.pauses.get(request.id))?.status).toBe("pending");
  });

  it("when the remaining approvers have all answered, the leave decides it at the leave instant", async () => {
    const { app, world, request } = await givenPending({ sofia: true });
    await respondToPause(atInstant(app, afterHours(T0, 1)), world.sofia, {
      pauseRequestId: request.id,
      decision: "approve",
    });
    const at = localInstant(dayOf(6), 9 * 3_600_000);

    await leave(app, world.victor, world, at);

    expect(await app.pauses.get(request.id)).toMatchObject({
      status: "approved",
      decidedAt: at,
      decidedOn: 6,
    });
  });

  it("PL-9: if no approver is left it is approved at the moment the last one leaves", async () => {
    const { app, world, request } = await givenPending({ sofia: false });
    const at = localInstant(dayOf(6), 9 * 3_600_000);

    await leave(app, world.victor, world, at);

    expect(await app.pauses.get(request.id)).toMatchObject({
      status: "approved",
      decidedAt: at,
      decidedOn: 6,
    });
  });

  it("a request already past its deadline keeps the deadline's own decision and day", async () => {
    const { app, world, request } = await givenPending({ sofia: false });

    await leave(app, world.victor, world, localInstant(dayOf(9)));

    expect(await app.pauses.get(request.id)).toMatchObject({
      status: "approved",
      decidedAt: request.autoApproveAt,
      decidedOn: 7,
    });
  });

  it("the requester leaving cancels their pending requests on the leave day", async () => {
    const { app, world, request } = await givenPending({ sofia: true });
    const at = localInstant(dayOf(6), 9 * 3_600_000);

    await leave(app, world.andrea, world, at);

    expect(await app.pauses.get(request.id)).toMatchObject({
      status: "cancelled",
      decidedAt: at,
      decidedOn: 6,
    });
  });

  it("PL-36: the leaver's approved pause does not change what the others score", async () => {
    const { app, world, request } = await givenPending({ sofia: false });
    await respondToPause(atInstant(app, afterHours(T0, 1)), world.victor, {
      pauseRequestId: request.id,
      decision: "approve",
    });
    const at = localInstant(dayOf(9));
    const score = () =>
      memberScore(atInstant(app, at), world.victor, { seasonId: world.season.id });
    const before = await score();

    await leave(app, world.andrea, world, at);
    const after = await score();

    expect(after).toEqual(before);
    expect((await app.pauses.get(request.id))?.status).toBe("approved");
  });

  it("does nothing to pauses while the season's pact is still open", async () => {
    const app = createTestApp({ now: T0, timeZone: fixtureTimeZone });
    const world = await givenPauseWorld(app, { withSofia: true });
    await app.uow.transaction(async ({ seasons }) => {
      const season = await seasons.get(world.season.id);
      if (!season) throw new Error("missing season");
      await seasons.save(
        { ...season, status: "pactOpen", actualStart: null, version: season.version + 1 },
        season.version,
      );
      return { ok: true, value: undefined };
    });

    const result = await leave(app, world.victor, world, T0);

    expect(result.ok).toBe(true);
    expect(
      result.ok && result.value.members.find((m) => m.userId === world.victor.userId)?.status,
    ).toBe("left");
  });
});
