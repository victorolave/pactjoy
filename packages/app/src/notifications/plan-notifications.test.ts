import { describe, expect, it } from "vitest";
import { requestPause } from "../pause/request-pause.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import {
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { givenPauseWorld } from "../testing/pause-fixtures.ts";
import { localDate } from "../time/local-date.ts";
import { planNotifications } from "./plan-notifications.ts";

/**
 * The planner (ADR-0017, design J6): calendar notices derived from state and the clock, planned
 * only inside 09:00-22:00 season-local, deduped by key so any re-run (or a late run) adds nothing.
 * The fixture season starts 2026-10-01 (UTC-3), lasts 4 weeks with a 2-week cadence: interim review
 * 1 opens 2026-10-15, the grace day is 2026-10-29 and the results open 2026-10-30.
 */

const at = (date: string, hour: number, minute = 0) =>
  localInstant(localDate(date), (hour * 60 + minute) * 60_000);

async function given(status: "active" | "closed" | "pactOpen" = "active") {
  const app = createTestApp({ now: at("2026-10-01", 9, 30), timeZone: fixtureTimeZone });
  const world = await givenActiveSeason(app, PER_DAY_REACH, status);
  return { app, world };
}

const plan = (app: TestApp, date: string, hour: number, minute = 0) =>
  planNotifications(atInstant(app, at(date, hour, minute)), {});

const rows = (app: TestApp) =>
  app.notifications
    .all()
    .map((n) => [n.kind, n.recipientMemberId, n.dedupeKey])
    .sort((a, b) => String(a[2]).localeCompare(String(b[2])));

describe("planNotifications: seasonStarted", () => {
  it("plans one per participant on the start day, 09:00-22:00, with one rollover", async () => {
    const { app, world } = await given();
    expect(await plan(app, "2026-10-01", 9, 30)).toEqual({ ok: true, value: { enqueued: 2 } });
    expect(rows(app)).toEqual([
      ["seasonStarted", "member-andrea", `seasonStarted:${world.season.id}:member-andrea`],
      ["seasonStarted", "member-victor", `seasonStarted:${world.season.id}:member-victor`],
    ]);
    expect(app.notifications.all()[0]).toMatchObject({
      params: { seasonId: world.season.id },
      circleId: world.circle.id,
      seasonId: world.season.id,
      notBefore: at("2026-10-01", 9),
      expiresAt: at("2026-10-01", 22),
      rolloversLeft: 1,
    });
  });

  it("SC-J4: a second run (or a later one the same day) adds nothing", async () => {
    const { app } = await given();
    await plan(app, "2026-10-01", 9, 30);
    expect(await plan(app, "2026-10-01", 9, 45)).toEqual({ ok: true, value: { enqueued: 0 } });
    expect(await plan(app, "2026-10-01", 21, 59)).toEqual({ ok: true, value: { enqueued: 0 } });
  });

  it.each([
    [8, 59],
    [22, 0],
    [23, 30],
  ])("plans nothing outside 09:00-22:00 (%i:%i)", async (hour, minute) => {
    const { app } = await given();
    expect(await plan(app, "2026-10-01", hour, minute)).toEqual({
      ok: true,
      value: { enqueued: 0 },
    });
  });

  it("a day missed entirely is planned the next day once, in that day's window, with no rollover left", async () => {
    const { app } = await given();
    await plan(app, "2026-10-02", 10);
    const [first] = app.notifications.all();
    expect(app.notifications.all()).toHaveLength(2);
    expect(first).toMatchObject({
      kind: "seasonStarted",
      notBefore: at("2026-10-02", 9),
      expiresAt: at("2026-10-02", 22),
      rolloversLeft: 0,
    });
  });

  it("two days late is too late", async () => {
    const { app } = await given();
    expect(await plan(app, "2026-10-03", 10)).toEqual({ ok: true, value: { enqueued: 0 } });
  });

  it("a member who left gets nothing", async () => {
    const { app, world } = await given();
    const [andrea, victor] = world.circle.members;
    if (!andrea || !victor) throw new Error("fixture");
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(
        {
          ...world.circle,
          members: [andrea, { ...victor, status: "left", leftAt: at("2026-10-01", 8) }],
          version: world.circle.version + 1,
        },
        world.circle.version,
      );
      return { ok: true, value: undefined };
    });
    await plan(app, "2026-10-01", 9, 30);
    expect(rows(app).map((r) => r[1])).toEqual(["member-andrea"]);
  });

  it("a season whose pact is still open is not planned", async () => {
    const { app } = await given("pactOpen");
    expect(await plan(app, "2026-10-01", 9, 30)).toEqual({ ok: true, value: { enqueued: 0 } });
  });
});

describe("planNotifications: reviewDue and seasonClosed", () => {
  it("reviewDue on the first day of an interim review, keyed by period", async () => {
    const { app, world } = await given();
    await plan(app, "2026-10-15", 9, 0);
    expect(rows(app)).toEqual([
      ["reviewDue", "member-andrea", `reviewDue:${world.season.id}:1:member-andrea`],
      ["reviewDue", "member-victor", `reviewDue:${world.season.id}:1:member-victor`],
    ]);
    expect(app.notifications.all()[0]).toMatchObject({
      params: { seasonId: world.season.id, periodIndex: 1 },
      rolloversLeft: 1,
    });
  });

  it("REQ-K5: no reviewDue for the closing review; seasonClosed on the results day instead", async () => {
    const { app, world } = await given();
    expect(await plan(app, "2026-10-29", 9, 30)).toEqual({ ok: true, value: { enqueued: 0 } });
    await plan(app, "2026-10-30", 9, 30);
    expect(rows(app)).toEqual([
      ["seasonClosed", "member-andrea", `seasonClosed:${world.season.id}:member-andrea`],
      ["seasonClosed", "member-victor", `seasonClosed:${world.season.id}:member-victor`],
    ]);
  });

  it("a season finalized early on its results day still gets seasonClosed", async () => {
    const { app } = await given("closed");
    await plan(app, "2026-10-30", 9, 30);
    expect(rows(app).map((r) => r[0])).toEqual(["seasonClosed", "seasonClosed"]);
  });
});

describe("planNotifications: pauseEndsTomorrow", () => {
  it("SC-K3: the pauser hears at 09:00 the day before the last day, once", async () => {
    const app = createTestApp({ now: localInstant(dayOf(5)), timeZone: fixtureTimeZone });
    const world = await givenPauseWorld(app, { solo: true });
    const request = await requestPause(app, world.andrea, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: world.andreaCommitment },
      reason: "travel",
      note: null,
      startDate: dayOf(6),
      endDate: dayOf(8),
    });
    if (!request.ok) throw new Error("fixture failed");
    const tick = () =>
      planNotifications(atInstant(app, localInstant(dayOf(7), 9 * 3_600_000 + 60_000)), {});

    await tick();
    await tick();

    const notices = app.notifications.all().filter((n) => n.kind === "pauseEndsTomorrow");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      dedupeKey: `pauseEndsTomorrow:${world.season.id}:${request.value.id}:${dayOf(8)}:member-andrea`,
      recipientMemberId: "member-andrea",
      params: { seasonId: world.season.id, pauseRequestId: request.value.id, lastDate: dayOf(8) },
      rolloversLeft: 0,
    });
  });
});
