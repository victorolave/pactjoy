import { describe, expect, it } from "vitest";
import type { Measure } from "../commitment/commitment.ts";
import type { SeasonStatus } from "../season/season.ts";
import { habitId, userId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { habitFixture } from "../testing/builders.ts";
import { fixtureTimeZone, givenActiveSeason, localInstant } from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH, TIMES_PER_WEEK } from "../testing/entry-measures.ts";
import { instant } from "../time/instant.ts";
import {
  getCommitmentReminder,
  type SetCommitmentReminderInput,
  setCommitmentReminder,
} from "./commitment-reminder-setting.ts";

const TUE_THU_SAT: Measure = {
  ...PER_DAY_REACH,
  schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [1, 3, 5] } },
};

async function given(measure: Measure = TUE_THU_SAT, status: SeasonStatus = "active") {
  const app = createTestApp({ now: localInstant(dayOf(2)), timeZone: fixtureTimeZone });
  const world = await givenActiveSeason(app, measure, status);
  const input = { seasonId: world.season.id, commitmentId: world.andreaCommitment };
  const set = (change: Partial<SetCommitmentReminderInput> = {}, a: TestApp = app) =>
    setCommitmentReminder(a, world.andrea, {
      ...input,
      enabled: true,
      minuteOfDay: 20 * 60,
      weekdays: [1, 3, 5],
      ...change,
    });
  return { app, world, input, set };
}

describe("getCommitmentReminder (REQ-R1)", () => {
  it("shows the default to the owner before anything is saved: off, 20:00, its own days", async () => {
    const { app, world, input } = await given();
    expect(await getCommitmentReminder(app, world.andrea, input)).toEqual({
      ok: true,
      value: {
        commitmentId: world.andreaCommitment,
        enabled: false,
        minuteOfDay: 1200,
        weekdays: [1, 3, 5],
        availableWeekdays: [1, 3, 5],
      },
    });
  });

  it("any-day commitments default to every day", async () => {
    const { app, world, input } = await given(TIMES_PER_WEEK);
    const view = await getCommitmentReminder(app, world.andrea, input);
    expect(view.ok && view.value.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("SC-R8: another member's commitment is not found, and so is an unknown one", async () => {
    const { app, world, input } = await given();
    expect(await getCommitmentReminder(app, world.victor, input)).toEqual({
      ok: false,
      error: { kind: "CommitmentNotFound" },
    });
    expect(
      await getCommitmentReminder(app, world.andrea, {
        ...input,
        commitmentId: world.victorCommitment,
      }),
    ).toEqual({ ok: false, error: { kind: "CommitmentNotFound" } });
  });

  it("a non-member and an unknown season are refused", async () => {
    const { app, world, input } = await given();
    expect(await getCommitmentReminder(app, { userId: userId("stranger") }, input)).toEqual({
      ok: false,
      error: { kind: "NotAMember" },
    });
    expect(
      await getCommitmentReminder(app, world.andrea, {
        ...input,
        seasonId: "nope" as typeof input.seasonId,
      }),
    ).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
  });
});

describe("setCommitmentReminder (REQ-R1..R4)", () => {
  it("stores the owner's setting and returns it", async () => {
    const { app, world, input, set } = await given();
    const saved = await set({ minuteOfDay: 8 * 60 + 15, weekdays: [5, 1] });
    expect(saved).toEqual({
      ok: true,
      value: {
        commitmentId: world.andreaCommitment,
        enabled: true,
        minuteOfDay: 495,
        weekdays: [1, 5],
        availableWeekdays: [1, 3, 5],
      },
    });
    expect(await getCommitmentReminder(app, world.andrea, input)).toEqual(saved);
  });

  it("is idempotent: the same payload twice leaves one version", async () => {
    const { app, world, set } = await given();
    await set();
    await set();
    const stored = await app.reminders.get(world.season.id, world.andreaCommitment);
    expect(stored).toMatchObject({ version: 1, memberId: "member-andrea" });
    await set({ enabled: false });
    expect((await app.reminders.get(world.season.id, world.andreaCommitment))?.version).toBe(2);
  });

  it("SC-R9: never touches the pact, the season version or the approvals", async () => {
    const { app, world, set } = await given(TUE_THU_SAT, "pactOpen");
    const before = await app.seasons.get(world.season.id);
    expect(await set()).toMatchObject({ ok: true });
    expect(await app.seasons.get(world.season.id)).toEqual(before);
  });

  it("works while the pact is open and while the season runs, not once closed", async () => {
    for (const status of ["pactOpen", "active"] as const) {
      expect((await (await given(TUE_THU_SAT, status)).set()).ok).toBe(true);
    }
    expect(await (await given(TUE_THU_SAT, "closed")).set()).toEqual({
      ok: false,
      error: { kind: "SeasonClosed" },
    });
  });

  it.each([
    [{ minuteOfDay: 22 * 60 }, "time"],
    [{ minuteOfDay: 7 * 60 + 45 }, "time"],
    [{ minuteOfDay: 20 * 60 + 5 }, "time"],
    [{ weekdays: [] }, "noWeekdays"],
    [{ weekdays: [1, 1] }, "weekdays"],
    [{ weekdays: [2] }, "notScheduled"],
  ] as const)("REQ-R3: rejects %j (%s) and stores nothing", async (change, reason) => {
    const { app, world, set } = await given();
    expect(await set(change as Partial<SetCommitmentReminderInput>)).toEqual({
      ok: false,
      error: { kind: "InvalidReminder", reason },
    });
    expect(await app.reminders.get(world.season.id, world.andreaCommitment)).toBeNull();
  });

  it("only the owner can set it", async () => {
    const { app, world, input } = await given();
    const result = await setCommitmentReminder(app, world.victor, {
      ...input,
      enabled: true,
      minuteOfDay: 1200,
      weekdays: [1],
    });
    expect(result).toEqual({ ok: false, error: { kind: "CommitmentNotFound" } });
  });

  it("REQ-R3: a graduated habit cannot be reminded, but its reminder can still be turned off", async () => {
    const { app, world, set } = await given();
    await set();
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
    expect(await set({ minuteOfDay: 9 * 60 })).toEqual({
      ok: false,
      error: { kind: "HabitGraduated" },
    });
    expect((await set({ enabled: false })).ok).toBe(true);
  });
});
