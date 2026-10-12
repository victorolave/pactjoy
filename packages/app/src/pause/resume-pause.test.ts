import { pauseBudget, seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { recordEntry } from "../entry/record-entry.ts";
import { startWeekdayOf } from "../score/score-input.ts";
import { standings } from "../score/standings.query.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { atInstant, fixtureTimeZone, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf } from "../testing/entry-measures.ts";
import { afterHours, givenPauseWorld, type PauseWorld } from "../testing/pause-fixtures.ts";
import { loadEffectivePauses } from "./effective-pauses.ts";
import { requestPause } from "./request-pause.ts";
import { respondToPause } from "./respond-to-pause.ts";
import { resumePause } from "./resume-pause.ts";

/** Victor is the only approver (no Sofia), so his approval decides at once. */
async function givenApproved(
  options: { start?: number; end?: number | null; all?: boolean; requestDay?: number } = {},
) {
  const requestDay = options.requestDay ?? 5;
  const app = createTestApp({ now: localInstant(dayOf(requestDay)), timeZone: fixtureTimeZone });
  const world = await givenPauseWorld(app, { withReading: options.all === true });
  const created = await requestPause(app, world.andrea, {
    seasonId: world.season.id,
    scope: options.all
      ? { kind: "all" }
      : { kind: "commitment", commitmentId: world.andreaCommitment },
    reason: "health",
    note: null,
    startDate: dayOf(options.start ?? requestDay),
    endDate: options.end === null || options.end === undefined ? null : dayOf(options.end),
  });
  if (!created.ok) throw new Error(`fixture failed: ${created.error.kind}`);
  const approved = await respondToPause(
    atInstant(app, afterHours(app.clock.now(), 1)),
    world.victor,
    {
      pauseRequestId: created.value.id,
      decision: "approve",
    },
  );
  if (!approved.ok) throw new Error("approval failed");
  return { app, world, request: approved.value };
}

const resume = (
  app: TestApp,
  actor: PauseWorld["andrea"],
  id: Awaited<ReturnType<typeof givenApproved>>["request"]["id"],
  day: number,
  commitmentId?: PauseWorld["andreaCommitment"],
) =>
  resumePause(atInstant(app, localInstant(dayOf(day), 8 * 3_600_000)), actor, {
    pauseRequestId: id,
    ...(commitmentId === undefined ? {} : { commitmentId }),
  });

/** Days charged to the Commitment's cap as of `today`: approved paused days (and pending hold). */
async function usedDays(app: TestApp, world: PauseWorld, today: number) {
  const season = (await app.seasons.get(world.season.id)) ?? world.season;
  const circle = (await app.circles.get(season.circleId)) ?? world.circle;
  const pauses = await app.uow.read((repos) =>
    loadEffectivePauses(repos, { season, circle, now: app.clock.now(), timeZone: app.timeZone }),
  );
  const start = season.actualStart;
  if (start === null) throw new Error("season has no start");
  return pauseBudget(
    { lengthWeeks: season.lengthWeeks, startWeekday: startWeekdayOf(start) },
    pauses.filter((p) => p.commitmentId === world.andreaCommitment),
    seasonDay(today),
  ).usedDays;
}

describe("resumePause (PL-30..PL-33, Q6)", () => {
  it("PL-S27: resuming a running open pause sets resumedOn to today and keeps the days before", async () => {
    const { app, world, request } = await givenApproved();
    const at = localInstant(dayOf(13), 8 * 3_600_000);

    const result = await resume(app, world.andrea, request.id, 13);

    expect(result.ok && result.value.status).toBe("approved");
    expect(result.ok && result.value.commitments).toEqual([
      { commitmentId: world.andreaCommitment, resumedOn: 13, resumedAt: at },
    ]);
    // Paused 5..12 = 8 days; the Commitment counts again from day 13.
    expect(await usedDays(atInstant(app, at), world, 13)).toBe(8);
    expect(await usedDays(atInstant(app, at), world, 20)).toBe(8);
  });

  it("PL-S28: resuming an approved pause that has not started acts as a cancel", async () => {
    const { app, world, request } = await givenApproved({ start: 10, end: 14 });

    const result = await resume(app, world.andrea, request.id, 6);

    expect(result.ok && result.value.status).toBe("approved");
    expect(result.ok && result.value.commitments[0]?.resumedOn).toBe(6);
    expect(await usedDays(app, world, 20)).toBe(0);
  });

  it("PL-S29: a fixed pause that already ended is PauseNotActive", async () => {
    const { app, world, request } = await givenApproved({ start: 5, end: 8 });

    const result = await resume(app, world.andrea, request.id, 9);

    expect(result).toEqual({ ok: false, error: { kind: "PauseNotActive" } });
  });

  it("a fixed pause can still be resumed on its last day", async () => {
    const { app, world, request } = await givenApproved({ start: 5, end: 8 });

    const result = await resume(app, world.andrea, request.id, 8);

    expect(result.ok).toBe(true);
  });

  it("an open pause that reached the cap ended by itself: PauseNotActive", async () => {
    // Cap is 14 days: an open pause from day 5 covers 5..18 and counts normally from day 19.
    const { app, world, request } = await givenApproved();

    const result = await resume(app, world.andrea, request.id, 19);

    expect(result).toEqual({ ok: false, error: { kind: "PauseNotActive" } });
  });

  it("PL-S22: an open pause ends at the cap, so the Commitment is paused through day 18 and scores from day 19", async () => {
    // Cap is 14 days: an open pause from day 5 covers 5..18.
    const { app, world } = await givenApproved();
    const logOn = (day: number) =>
      recordEntry(atInstant(app, localInstant(dayOf(day))), world.andrea, {
        seasonId: world.season.id,
        commitmentId: world.andreaCommitment,
        forDate: dayOf(day),
        value: { kind: "quantity", value: "30" },
        note: null,
        clientRequestId: `cap-${day}`,
      });
    const pointsAt = async (day: number) => {
      const view = await standings(atInstant(app, localInstant(dayOf(day))), world.andrea, {
        seasonId: world.season.id,
      });
      if (!view.ok || view.value.kind !== "ranked") throw new Error("standings unavailable");
      return view.value.rows.find((row) => row.memberId === "member-andrea")?.points ?? 0;
    };

    expect(await logOn(18)).toEqual({ ok: false, error: { kind: "OpportunityPaused" } });
    expect((await logOn(19)).ok).toBe(true);
    expect(await pointsAt(19)).toBeGreaterThan(0);
  });

  it("PL-S30: resuming a pending request is PauseNotPending (it is cancelled instead)", async () => {
    const app = createTestApp({ now: localInstant(dayOf(5)), timeZone: fixtureTimeZone });
    const world = await givenPauseWorld(app, { withSofia: true });
    const created = await requestPause(app, world.andrea, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: world.andreaCommitment },
      reason: "health",
      note: null,
      startDate: dayOf(5),
      endDate: null,
    });
    if (!created.ok) throw new Error("fixture failed");

    const result = await resume(app, world.andrea, created.value.id, 5);

    expect(result).toEqual({ ok: false, error: { kind: "PauseNotPending" } });
  });

  it("a rejected request was never active: PauseNotActive", async () => {
    const app = createTestApp({ now: localInstant(dayOf(5)), timeZone: fixtureTimeZone });
    const world = await givenPauseWorld(app, {});
    const created = await requestPause(app, world.andrea, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: world.andreaCommitment },
      reason: "health",
      note: null,
      startDate: dayOf(5),
      endDate: null,
    });
    if (!created.ok) throw new Error("fixture failed");
    await respondToPause(atInstant(app, afterHours(app.clock.now(), 1)), world.victor, {
      pauseRequestId: created.value.id,
      decision: "reject",
    });

    const result = await resume(app, world.andrea, created.value.id, 6);

    expect(result).toEqual({ ok: false, error: { kind: "PauseNotActive" } });
  });

  it("PL-S31: a second resume is PauseNotActive and changes nothing", async () => {
    const { app, world, request } = await givenApproved();
    await resume(app, world.andrea, request.id, 8);
    const before = await app.pauses.get(request.id);

    const again = await resume(app, world.andrea, request.id, 8);

    expect(again).toEqual({ ok: false, error: { kind: "PauseNotActive" } });
    expect(await app.pauses.get(request.id)).toEqual(before);
  });

  it("only the requester can resume; a stranger or unknown id gets PauseRequestNotFound", async () => {
    const { app, world, request } = await givenApproved();

    expect(await resume(app, world.victor, request.id, 8)).toEqual({
      ok: false,
      error: { kind: "NotPauseRequester" },
    });
    expect(await resume(app, { userId: userId("user-nobody") }, request.id, 8)).toEqual({
      ok: false,
      error: { kind: "PauseRequestNotFound" },
    });
    expect(await resume(app, world.andrea, "nope" as never, 8)).toEqual({
      ok: false,
      error: { kind: "PauseRequestNotFound" },
    });
  });

  it("a Commitment that is not part of the request is CommitmentNotOwned", async () => {
    const { app, world, request } = await givenApproved();

    const result = await resume(app, world.andrea, request.id, 8, world.victorCommitment);

    expect(result).toEqual({ ok: false, error: { kind: "CommitmentNotOwned" } });
  });

  it("PL-33: Todos resumes one Commitment, then only the ones still running", async () => {
    const { app, world, request } = await givenApproved({ all: true });

    const one = await resume(app, world.andrea, request.id, 8, world.andreaReading);
    expect(one.ok && one.value.commitments.map((c) => c.resumedOn)).toEqual([null, 8]);

    const rest = await resume(app, world.andrea, request.id, 9);
    expect(rest.ok && rest.value.commitments.map((c) => c.resumedOn)).toEqual([9, 8]);

    const none = await resume(app, world.andrea, request.id, 9);
    expect(none).toEqual({ ok: false, error: { kind: "PauseNotActive" } });
  });
});
