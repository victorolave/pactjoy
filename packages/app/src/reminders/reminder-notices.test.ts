import type { Weekday } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { requestPause } from "../pause/request-pause.ts";
import type { SeasonStatus } from "../season/season.ts";
import { habitId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { habitFixture } from "../testing/builders.ts";
import {
  type ActiveSeasonFixture,
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH, TIMES_PER_WEEK, WEEKLY_TOTAL } from "../testing/entry-measures.ts";
import { givenPauseWorld } from "../testing/pause-fixtures.ts";
import { instant } from "../time/instant.ts";
import { setCommitmentReminder } from "./commitment-reminder-setting.ts";
import { dueReminders, isReminderStillDue, type ReminderContext } from "./reminder-notices.ts";

/**
 * What the planner owes and what dispatch re-checks (ADR-0017 addendum, design J18): a reminder is
 * due only from its time for one hour (never past 22:00), on its days, while that day is still open
 * to register for its owner, by the SAME `todayRows` the Today screen shows. The fixture season
 * starts Thursday 2026-10-01 (day 0, UTC-3) and lasts 4 weeks.
 */

const at = (day: number, hour: number, minute = 0) =>
  localInstant(dayOf(day), (hour * 60 + minute) * 60_000);

const ALL: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

async function given(measure: Measure = PER_DAY_REACH, status: SeasonStatus = "active") {
  const app = createTestApp({ now: at(0, 7), timeZone: fixtureTimeZone });
  const world = await givenActiveSeason(app, measure, status);
  return { app, world };
}

async function remind(
  app: TestApp,
  world: ActiveSeasonFixture,
  minuteOfDay = 20 * 60,
  weekdays: readonly Weekday[] = ALL,
  enabled = true,
) {
  const result = await setCommitmentReminder(app, world.andrea, {
    seasonId: world.season.id,
    commitmentId: world.andreaCommitment,
    enabled,
    minuteOfDay,
    weekdays,
  });
  if (!result.ok) throw new Error(`fixture: ${result.error.kind}`);
}

async function record(app: TestApp, world: ActiveSeasonFixture, day: number, value: string) {
  const result = await recordEntry(atInstant(app, at(day, 12)), world.andrea, {
    seasonId: world.season.id,
    commitmentId: world.andreaCommitment,
    forDate: dayOf(day),
    value: value === "missed" ? { kind: "missed" } : { kind: "quantity", value },
    note: null,
    clientRequestId: `req-${day}-${value}`,
  });
  if (!result.ok) throw new Error(`fixture: ${result.error.kind}`);
}

const due = async (app: TestApp, world: ActiveSeasonFixture, now: number) =>
  app.uow.read(async (repos) => {
    const season = await repos.seasons.get(world.season.id);
    const circle = await repos.circles.get(world.circle.id);
    if (!season || !circle) throw new Error("fixture");
    const context: ReminderContext = { season, circle, now: instant(now), timeZone: app.timeZone };
    return dueReminders(repos, context);
  });

const stillDue = async (app: TestApp, world: ActiveSeasonFixture, now: number, day: number) =>
  app.uow.read(async (repos) => {
    const season = await repos.seasons.get(world.season.id);
    const circle = await repos.circles.get(world.circle.id);
    if (!season || !circle) throw new Error("fixture");
    return isReminderStillDue(
      repos,
      { season, circle, now: instant(now), timeZone: app.timeZone },
      {
        memberId: world.season.commitments[0]?.memberId ?? ("" as never),
        commitmentId: world.andreaCommitment,
        forDate: dayOf(day),
      },
    );
  });

describe("dueReminders: when (REQ-R5, REQ-R7)", () => {
  it("SC-R1: due from its time, to the owner, valid for one hour", async () => {
    const { app, world } = await given();
    await remind(app, world);
    expect(await due(app, world, at(2, 20, 5))).toEqual([
      {
        memberId: "member-andrea",
        userId: world.andrea.userId,
        commitmentId: world.andreaCommitment,
        forDate: dayOf(2),
        notBefore: at(2, 20),
        expiresAt: at(2, 21),
      },
    ]);
  });

  it.each([
    [19, 59],
    [21, 0],
    [23, 0],
  ])("not due outside its hour (%i:%i)", async (hour, minute) => {
    const { app, world } = await given();
    await remind(app, world);
    expect(await due(app, world, at(2, hour, minute))).toEqual([]);
  });

  it("a 21:45 reminder is valid until 22:00 only, when quiet hours start", async () => {
    const { app, world } = await given();
    await remind(app, world, 21 * 60 + 45);
    const [reminder] = await due(app, world, at(2, 21, 50));
    expect(reminder?.expiresAt).toBe(at(2, 22));
    expect(await due(app, world, at(2, 22))).toEqual([]);
  });

  it("SC-R7: only on its days, and never when turned off", async () => {
    const { app, world } = await given();
    // Engine weekdays count from Monday = 0: day 2 is Saturday 2026-10-03 (5), day 4 is Monday (0).
    await remind(app, world, 20 * 60, [0, 2, 4]);
    expect(await due(app, world, at(2, 20, 5))).toEqual([]);
    expect(await due(app, world, at(4, 20, 5))).toHaveLength(1);
    await remind(app, world, 20 * 60, [0, 2, 4], false);
    expect(await due(app, world, at(4, 20, 5))).toEqual([]);
  });
});

describe("dueReminders: silenced days (REQ-R6)", () => {
  it("SC-R2: a day already registered", async () => {
    const { app, world } = await given();
    await remind(app, world);
    await record(app, world, 2, "30");
    expect(await due(app, world, at(2, 20, 5))).toEqual([]);
    expect(await due(app, world, at(3, 20, 5))).toHaveLength(1);
  });

  it('SC-R3: "Hoy no salió" silences the day too', async () => {
    const { app, world } = await given();
    await remind(app, world);
    await record(app, world, 2, "missed");
    expect(await due(app, world, at(2, 20, 5))).toEqual([]);
  });

  it("SC-R4: timesPerWeek once the week reached its sessions", async () => {
    const { app, world } = await given(TIMES_PER_WEEK);
    await remind(app, world);
    await record(app, world, 0, "30");
    await record(app, world, 1, "30");
    expect(await due(app, world, at(3, 20, 5))).toHaveLength(1);
    await record(app, world, 2, "30");
    expect(await due(app, world, at(3, 20, 5))).toEqual([]);
  });

  it("weeklyTotal reach once the week reached its ideal", async () => {
    const { app, world } = await given(WEEKLY_TOTAL);
    await remind(app, world);
    await record(app, world, 0, "10");
    expect(await due(app, world, at(2, 20, 5))).toHaveLength(1);
    await record(app, world, 1, "20");
    expect(await due(app, world, at(2, 20, 5))).toEqual([]);
  });

  it("SC-R6: a paused day", async () => {
    const app = createTestApp({ now: at(0, 12), timeZone: fixtureTimeZone });
    const world = await givenPauseWorld(app, { solo: true });
    await remind(app, world);
    const pause = await requestPause(app, world.andrea, {
      seasonId: world.season.id,
      scope: { kind: "commitment", commitmentId: world.andreaCommitment },
      reason: "travel",
      note: null,
      startDate: dayOf(2),
      endDate: dayOf(3),
    });
    if (!pause.ok) throw new Error(`fixture: ${pause.error.kind}`);
    expect(await due(app, world, at(2, 20, 5))).toEqual([]);
    expect(await due(app, world, at(4, 20, 5))).toHaveLength(1);
  });

  it.each(["pactOpen", "closed"] as const)("a season that is %s", async (status) => {
    const { app, world } = await given(PER_DAY_REACH, "active");
    await remind(app, world);
    await app.uow.transaction(async (repos) => {
      await repos.seasons.save(
        { ...world.season, status, version: world.season.version + 1 },
        world.season.version,
      );
      return { ok: true, value: undefined };
    });
    expect(await due(app, world, at(2, 20, 5))).toEqual([]);
  });

  it("a day after the season's last day", async () => {
    const { app, world } = await given();
    await remind(app, world);
    expect(await due(app, world, at(27, 20, 5))).toHaveLength(1);
    expect(await due(app, world, at(28, 20, 5))).toEqual([]);
  });

  it("an owner who left the circle", async () => {
    const { app, world } = await given();
    await remind(app, world);
    const [andrea, victor] = world.circle.members;
    if (!andrea || !victor) throw new Error("fixture");
    await app.uow.transaction(async (repos) => {
      await repos.circles.save(
        {
          ...world.circle,
          members: [{ ...andrea, status: "left", leftAt: at(1, 8) }, victor],
          version: world.circle.version + 1,
        },
        world.circle.version,
      );
      return { ok: true, value: undefined };
    });
    expect(await due(app, world, at(2, 20, 5))).toEqual([]);
  });

  it("a graduated habit", async () => {
    const { app, world } = await given();
    await remind(app, world);
    await app.uow.transaction(async (repos) => {
      await repos.habits.save(
        habitFixture({
          id: habitId("habit-andrea"),
          ownerId: world.andrea.userId,
          name: "Meditar",
          graduatedAt: instant(1),
          version: 1,
        }),
        0,
      );
      return { ok: true, value: undefined };
    });
    expect(await due(app, world, at(2, 20, 5))).toEqual([]);
  });
});

describe("isReminderStillDue: dispatch re-check (REQ-R8, SC-R10)", () => {
  it("holds while the day is still open and the reminder on", async () => {
    const { app, world } = await given();
    await remind(app, world);
    expect(await stillDue(app, world, at(2, 20, 10), 2)).toBe(true);
  });

  it("not once the day was registered after planning", async () => {
    const { app, world } = await given();
    await remind(app, world);
    await record(app, world, 2, "30");
    expect(await stillDue(app, world, at(2, 20, 10), 2)).toBe(false);
  });

  it("SC-R10: not once the reminder was turned off, or that day removed", async () => {
    const { app, world } = await given();
    await remind(app, world, 20 * 60, ALL, false);
    expect(await stillDue(app, world, at(2, 20, 10), 2)).toBe(false);
    // Day 2 is a Saturday (5): a Monday-and-Tuesday reminder does not cover it.
    await remind(app, world, 20 * 60, [0, 1]);
    expect(await stillDue(app, world, at(2, 20, 10), 2)).toBe(false);
  });

  it("not for another day than the one it was planned for", async () => {
    const { app, world } = await given();
    await remind(app, world);
    expect(await stillDue(app, world, at(3, 8, 10), 2)).toBe(false);
  });
});
