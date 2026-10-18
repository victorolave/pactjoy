import { describe, expect, it } from "vitest";
import { buildCommitment, commitmentId } from "../commitment/commitment.ts";
import { recordEntry } from "../entry/record-entry.ts";
import { dispatchNotifications } from "../notifications/dispatch-notifications.ts";
import { planNotifications } from "../notifications/plan-notifications.ts";
import { habitId, pushSubscriptionId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { habitFixture } from "../testing/builders.ts";
import {
  type ActiveSeasonFixture,
  atInstant,
  fixtureTimeZone,
  givenActiveSeason,
  localInstant,
} from "../testing/entry-fixtures.ts";
import { dayOf, PER_DAY_REACH } from "../testing/entry-measures.ts";
import { pushSubscriptionFixture } from "../testing/notification-fixtures.ts";
import { createRecordingPushSender } from "../testing/recording-push-sender.ts";
import { setCommitmentReminder } from "./commitment-reminder-setting.ts";

/**
 * Reminders through the real jobs (ADR-0017 addendum, D2): `planNotifications` adds the reminders
 * due now, `dispatchNotifications` re-checks and sends them. The fixture season starts Thursday
 * 2026-10-01 (day 0, UTC-3); day 2 is a Saturday.
 */

const at = (day: number, hour: number, minute = 0) =>
  localInstant(dayOf(day), (hour * 60 + minute) * 60_000);

async function given() {
  const app = createTestApp({ now: at(0, 7), timeZone: fixtureTimeZone });
  const world = await givenActiveSeason(app, PER_DAY_REACH);
  await app.pushSubscriptions.upsert(
    pushSubscriptionFixture({
      id: pushSubscriptionId("device-andrea"),
      userId: world.andrea.userId,
      endpoint: "https://push.example/andrea",
    }),
  );
  const push = createRecordingPushSender();
  const tick = async (now: number) => {
    const clocked = atInstant(app, now as Parameters<typeof atInstant>[1]);
    const planned = await planNotifications(clocked, {});
    const sent = await dispatchNotifications({ ...clocked, push }, {});
    return { planned, sent };
  };
  return { app, world, push, tick };
}

async function remind(
  app: TestApp,
  world: ActiveSeasonFixture,
  commitment = world.andreaCommitment,
  minuteOfDay = 20 * 60,
  enabled = true,
) {
  const result = await setCommitmentReminder(app, world.andrea, {
    seasonId: world.season.id,
    commitmentId: commitment,
    enabled,
    minuteOfDay,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  });
  if (!result.ok) throw new Error(`fixture: ${result.error.kind}`);
}

describe("commitment reminders through plan and dispatch", () => {
  it("SC-R1: one push at its time to the owner, ids only; another run sends none", async () => {
    const { app, world, push, tick } = await given();
    await remind(app, world);

    await tick(at(2, 20, 5));
    await tick(at(2, 20, 20));
    await tick(at(2, 20, 50));

    expect(push.sent.map((s) => s.payload)).toEqual([
      {
        v: 1,
        kind: "commitmentReminder",
        params: {
          seasonId: world.season.id,
          commitmentId: world.andreaCommitment,
          forDate: dayOf(2),
        },
      },
    ]);
    const [row] = app.notifications.all();
    expect(row).toMatchObject({
      dedupeKey: `commitmentReminder:${world.season.id}:${world.andreaCommitment}:${dayOf(2)}:member-andrea`,
      recipientMemberId: "member-andrea",
      notBefore: at(2, 20),
      expiresAt: at(2, 21),
      rolloversLeft: 0,
      state: "sent",
    });
    // Never the habit name, even for a visible commitment: the device names it (REQ-K1).
    expect(JSON.stringify(app.notifications.all())).not.toContain("Meditar");
  });

  it("the next day gets its own reminder", async () => {
    const { app, world, push, tick } = await given();
    await remind(app, world);
    await tick(at(2, 20, 5));
    await tick(at(3, 20, 5));
    expect(
      push.sent.map((s) => (s.payload as { params: { forDate: string } }).params.forDate),
    ).toEqual([dayOf(2), dayOf(3)]);
  });

  it("an 08:15 reminder goes out before the 09:00 calendar window opens", async () => {
    const { app, world, push, tick } = await given();
    await remind(app, world, world.andreaCommitment, 8 * 60 + 15);
    await tick(at(2, 8, 20));
    expect(push.sent).toHaveLength(1);
  });

  it("SC-R2: registered at 19:30, no reminder at 20:00", async () => {
    const { app, world, push, tick } = await given();
    await remind(app, world);
    const entry = await recordEntry(atInstant(app, at(2, 19, 30)), world.andrea, {
      seasonId: world.season.id,
      commitmentId: world.andreaCommitment,
      forDate: dayOf(2),
      value: { kind: "quantity", value: "30" },
      note: null,
      clientRequestId: "req-1",
    });
    expect(entry.ok).toBe(true);
    await tick(at(2, 20, 5));
    expect(push.sent).toEqual([]);
    expect(app.notifications.all()).toEqual([]);
  });

  it("REQ-R8: registered between planning and dispatch, the planned reminder is dropped", async () => {
    const { app, world, push } = await given();
    await remind(app, world);
    await planNotifications(atInstant(app, at(2, 20, 5)), {});
    await recordEntry(atInstant(app, at(2, 20, 6)), world.andrea, {
      seasonId: world.season.id,
      commitmentId: world.andreaCommitment,
      forDate: dayOf(2),
      value: { kind: "missed" },
      note: null,
      clientRequestId: "req-1",
    });
    await dispatchNotifications({ ...atInstant(app, at(2, 20, 7)), push }, {});
    expect(push.sent).toEqual([]);
    expect(app.notifications.all()[0]).toMatchObject({ state: "dropped", outcome: "irrelevant" });
  });

  it("SC-R10: turned off after planning, the planned reminder is dropped", async () => {
    const { app, world, push } = await given();
    await remind(app, world);
    await planNotifications(atInstant(app, at(2, 20, 5)), {});
    await remind(app, world, world.andreaCommitment, 20 * 60, false);
    await dispatchNotifications({ ...atInstant(app, at(2, 20, 6)), push }, {});
    expect(push.sent).toEqual([]);
    expect(app.notifications.all()[0]).toMatchObject({ state: "dropped", outcome: "irrelevant" });
  });

  it("SC-R5: with the jobs down until 21:10, a 20:00 reminder is dropped, never sent late", async () => {
    const { app, world, push, tick } = await given();
    await remind(app, world);
    await planNotifications(atInstant(app, at(2, 20, 5)), {});
    await tick(at(2, 21, 10));
    expect(push.sent).toEqual([]);
    expect(app.notifications.all()[0]).toMatchObject({ state: "dropped", outcome: "expired" });
  });

  it("SC-R11: three commitments at the same time are three pushes, one per commitment", async () => {
    const { app, world, push, tick } = await given();
    const extra = [commitmentId("commitment-andrea-2"), commitmentId("commitment-andrea-3")];
    await app.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(world.season.id);
      if (!season) throw new Error("fixture");
      await repos.seasons.save(
        {
          ...season,
          commitments: [
            ...season.commitments.map((c) =>
              c.id === world.andreaCommitment ? { ...c, weightPercent: 34 } : c,
            ),
            ...extra.map((id, i) =>
              buildCommitment({
                id,
                memberId: season.commitments[0]?.memberId ?? ("" as never),
                habitId: habitId(`habit-andrea-${i + 2}`),
                weightPercent: 33,
                privacy: i === 0 ? "private" : "visible",
                measure: PER_DAY_REACH,
              }),
            ),
          ],
          version: season.version + 1,
        },
        season.version,
      );
      for (const [i] of extra.entries()) {
        await repos.habits.save(
          habitFixture({
            id: habitId(`habit-andrea-${i + 2}`),
            ownerId: world.andrea.userId,
            name: `Hábito ${i + 2}`,
          }),
          null,
        );
      }
      return { ok: true, value: undefined };
    });
    for (const id of [world.andreaCommitment, ...extra]) await remind(app, world, id);

    await tick(at(2, 20, 5));
    await tick(at(2, 20, 20));

    const ids = push.sent.map(
      (s) => (s.payload as { params: { commitmentId: string } }).params.commitmentId,
    );
    expect(ids.sort()).toEqual([world.andreaCommitment, ...extra].sort());
  });
});
