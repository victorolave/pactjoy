import { describe, expect, it } from "vitest";
import { leaveCircle } from "../circle/leave-circle.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { atInstant, fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import { afterHours, givenPauseWorld, type PauseWorld } from "../testing/pause-fixtures.ts";
import { pausesEndingTomorrow } from "./pause-notices.ts";
import { requestPause } from "./request-pause.ts";
import { respondToPause } from "./respond-to-pause.ts";
import { resumePause } from "./resume-pause.ts";
import { settleDuePauses } from "./settle-due-pauses.ts";

/**
 * Which pause events reach the outbox (ADR-0017, agy #5): a request that stays pending notifies
 * every approver; the requester hears once, when the request leaves `pending` for approved or
 * rejected, whichever write persists it (an answer, the 48 h job, a lazy settle, a leave). A
 * single reject in a larger circle decides nothing, so it notifies nothing.
 */

const T0 = localInstant(dayOf(5));

async function given(options: Parameters<typeof givenPauseWorld>[1] = { withSofia: true }) {
  const app = createTestApp({ now: T0, timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, options);
  const ask = async (at = app, actor = world.andrea, commitmentId = world.andreaCommitment) =>
    requestPause(at, actor, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId },
      reason: "work",
      note: null,
      startDate: dayOf(6),
      endDate: dayOf(8),
    });
  return { app, world, ask };
}

const answer = (
  app: TestApp,
  actor: PauseWorld["andrea"],
  id: string,
  decision: "approve" | "reject",
) => respondToPause(app, actor, { pauseRequestId: id as never, decision });

const notices = (app: TestApp) => app.notifications.all();
const summary = (app: TestApp) =>
  notices(app).map((n) => [n.kind, n.recipientMemberId, n.dedupeKey]);

describe("pauseRequested", () => {
  it("SC-K1: a pending request notifies every other active member, never the requester", async () => {
    const { app, world, ask } = await given();
    const request = await ask();
    if (!request.ok) throw new Error("fixture failed");

    expect(summary(app)).toEqual([
      ["pauseRequested", "member-sofia", `pauseRequested:${request.value.id}:member-sofia`],
      ["pauseRequested", "member-victor", `pauseRequested:${request.value.id}:member-victor`],
    ]);
    const toVictor = notices(app).find((n) => n.recipientMemberId === "member-victor");
    expect(toVictor).toMatchObject({
      params: { seasonId: world.season.id, pauseRequestId: request.value.id },
      circleId: world.circle.id,
      seasonId: world.season.id,
      recipientUserId: world.victor.userId,
      timeZone: world.season.timeZone,
      notBefore: T0,
      expiresAt: request.value.autoApproveAt,
      rolloversLeft: 0,
      state: "pending",
    });
  });

  it("a solo request is approved at once and notifies nobody (not even the requester)", async () => {
    const { app, ask } = await given({ solo: true });
    const request = await ask();
    expect(request.ok && request.value.status).toBe("approved");
    expect(notices(app)).toEqual([]);
  });

  it("SC-O1: a request that fails validation leaves no notice", async () => {
    const { app, world } = await given();
    const failed = await requestPause(app, world.andrea, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: world.andreaCommitment },
      reason: "work",
      note: null,
      startDate: dayOf(2),
      endDate: dayOf(3),
    });
    expect(failed.ok).toBe(false);
    expect(notices(app)).toEqual([]);
  });
});

describe("pausesEndingTomorrow (the pauseEndsTomorrow candidates, agy #12)", () => {
  async function solo(endDate: ReturnType<typeof dayOf> | null) {
    const { app, world } = await given({ solo: true });
    const request = await requestPause(app, world.andrea, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: world.andreaCommitment },
      reason: "travel",
      note: null,
      startDate: dayOf(6),
      endDate,
    });
    if (!request.ok) throw new Error("fixture failed");
    const on = (date: ReturnType<typeof dayOf>) =>
      app.uow.read((repos) =>
        pausesEndingTomorrow(repos, {
          season: world.season,
          circle: world.circle,
          now: localInstant(date),
          timeZone: fixtureTimeZone,
        }),
      );
    return { app, world, request: request.value, on };
  }

  it("SC-K3: an approved fixed pause is a candidate the day before its last day only", async () => {
    const { request, on } = await solo(dayOf(8));
    expect(await on(dayOf(6))).toEqual([]);
    expect(await on(dayOf(7))).toEqual([
      { record: expect.objectContaining({ id: request.id }), lastDate: dayOf(8) },
    ]);
    expect(await on(dayOf(8))).toEqual([]);
  });

  it("an open pause is a candidate the day before it reaches the 50% cap", async () => {
    // 4 weeks: the cap is 14 days, so an open pause from day 6 runs through day 19.
    const { request, on } = await solo(null);
    expect(await on(dayOf(17))).toEqual([]);
    expect(await on(dayOf(18))).toEqual([
      { record: expect.objectContaining({ id: request.id }), lastDate: dayOf(19) },
    ]);
  });

  it("a pending request is never a candidate", async () => {
    const { app, world, ask } = await given();
    const request = await ask();
    if (!request.ok) throw new Error("fixture failed");
    const found = await app.uow.read((repos) =>
      pausesEndingTomorrow(repos, {
        season: world.season,
        circle: world.circle,
        // 09:00 on day 7 is 45 h after the request: still pending (at noon it auto-approves).
        now: localInstant(dayOf(7), 9 * 3_600_000),
        timeZone: fixtureTimeZone,
      }),
    );
    expect(found).toEqual([]);
  });

  it("a resumed pause is not a candidate", async () => {
    const { app, world, request, on } = await solo(dayOf(8));
    const resumed = await resumePause(atInstant(app, localInstant(dayOf(7))), world.andrea, {
      pauseRequestId: request.id,
    });
    expect(resumed.ok).toBe(true);
    expect(await on(dayOf(7))).toEqual([]);
  });
});

describe("pauseApproved / pauseRejected", () => {
  it("one approval of two decides nothing; the last one notifies the requester once", async () => {
    const { app, world, ask } = await given();
    const request = await ask();
    if (!request.ok) throw new Error("fixture failed");
    const id = request.value.id;

    await answer(app, world.victor, id, "approve");
    expect(notices(app).filter((n) => n.kind !== "pauseRequested")).toEqual([]);
    await answer(app, world.sofia, id, "approve");

    const decided = notices(app).filter((n) => n.kind !== "pauseRequested");
    expect(decided.map((n) => [n.kind, n.recipientMemberId, n.dedupeKey])).toEqual([
      ["pauseApproved", "member-andrea", `pauseDecided:${id}`],
    ]);
    expect(decided[0]?.params).toEqual({ seasonId: world.season.id, pauseRequestId: id });
  });

  it("agy #5: a single reject in a three-member circle notifies nothing until the set completes", async () => {
    const { app, world, ask } = await given();
    const request = await ask();
    if (!request.ok) throw new Error("fixture failed");
    const id = request.value.id;

    await answer(app, world.victor, id, "reject");
    expect(notices(app).filter((n) => n.kind !== "pauseRequested")).toEqual([]);
    await answer(app, world.sofia, id, "approve");
    expect(
      notices(app)
        .filter((n) => n.kind !== "pauseRequested")
        .map((n) => [n.kind, n.recipientMemberId]),
    ).toEqual([["pauseRejected", "member-andrea"]]);
  });

  it("SC-K2: the 48 h job approves once and notifies once; a second run adds nothing", async () => {
    const { app, ask } = await given();
    const request = await ask();
    if (!request.ok) throw new Error("fixture failed");
    const later = atInstant(app, afterHours(T0, 49));

    await settleDuePauses(later, {});
    await settleDuePauses(later, {});

    expect(
      notices(app)
        .filter((n) => n.kind === "pauseApproved")
        .map((n) => [n.recipientMemberId, n.notBefore]),
    ).toEqual([["member-andrea", afterHours(T0, 49)]]);
  });

  it("a standing reject at the deadline notifies pauseRejected", async () => {
    const { app, world, ask } = await given();
    const request = await ask();
    if (!request.ok) throw new Error("fixture failed");
    await answer(app, world.victor, request.value.id, "reject");

    await settleDuePauses(atInstant(app, afterHours(T0, 49)), {});

    expect(notices(app).filter((n) => n.kind === "pauseRejected")).toHaveLength(1);
  });

  it("a lazy settle inside another write notifies too, and the job then finds nothing", async () => {
    const { app, world, ask } = await given();
    const request = await ask();
    if (!request.ok) throw new Error("fixture failed");
    const later = atInstant(app, afterHours(T0, 49));

    // Victor's own request settles Andrea's due one first (settle-first).
    await ask(later, world.victor, world.victorCommitment);
    await settleDuePauses(later, {});

    expect(notices(app).filter((n) => n.kind === "pauseApproved")).toHaveLength(1);
  });

  it("a leave that completes the answers notifies the requester; the leaver's own request notifies nobody", async () => {
    const { app, world, ask } = await given();
    const mine = await ask();
    const victors = await ask(app, world.victor, world.victorCommitment);
    if (!mine.ok || !victors.ok) throw new Error("fixture failed");
    await answer(app, world.sofia, mine.value.id, "approve");

    const left = await leaveCircle(app, world.victor, { circleId: world.circle.id });
    expect(left.ok).toBe(true);

    expect(
      notices(app)
        .filter((n) => n.kind === "pauseApproved" || n.kind === "pauseRejected")
        .map((n) => [n.kind, n.recipientMemberId, n.params.pauseRequestId]),
    ).toEqual([["pauseApproved", "member-andrea", mine.value.id]]);
  });
});
