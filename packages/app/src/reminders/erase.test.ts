import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import { seasonId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { instant } from "../time/instant.ts";
import type { CommitmentReminder } from "./commitment-reminder.ts";
import { dropSeasonReminders, eraseMemberReminders } from "./erase.ts";

const SEASON = seasonId("season-1");
const OTHER_SEASON = seasonId("season-2");
const ANDREA = memberId("member-andrea");
const VICTOR = memberId("member-victor");

const reminder = (
  commitment: string,
  member: typeof ANDREA,
  season = SEASON,
): CommitmentReminder => ({
  seasonId: season,
  commitmentId: commitmentId(commitment),
  memberId: member,
  enabled: true,
  minuteOfDay: 20 * 60,
  weekdays: [1, 3],
  updatedAt: instant(1_791_987_120_000),
  version: 1,
});

async function seeded() {
  const app = createTestApp();
  await app.uow.transaction(async ({ reminders }) => {
    await reminders.save(reminder("c-a1", ANDREA), null);
    await reminders.save(reminder("c-a2", ANDREA, OTHER_SEASON), null);
    await reminders.save(reminder("c-v1", VICTOR), null);
    return ok(undefined);
  });
  return app;
}

describe("eraseMemberReminders", () => {
  it("deletes the member's settings in every season and keeps a peer's", async () => {
    const app = await seeded();
    await app.uow.transaction(async (repos) => {
      await eraseMemberReminders(repos, [ANDREA]);
      return ok(undefined);
    });
    expect(await app.reminders.get(SEASON, commitmentId("c-a1"))).toBeNull();
    expect(await app.reminders.get(OTHER_SEASON, commitmentId("c-a2"))).toBeNull();
    expect((await app.reminders.listEnabled(SEASON)).map((r) => r.commitmentId)).toEqual([
      commitmentId("c-v1"),
    ]);
  });

  it("is undone when the transaction rolls back", async () => {
    const app = await seeded();
    await expect(
      app.uow.transaction(async (repos) => {
        await eraseMemberReminders(repos, [ANDREA, VICTOR]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await app.reminders.listEnabled(SEASON)).toHaveLength(2);
    expect(await app.reminders.listEnabled(OTHER_SEASON)).toHaveLength(1);
  });
});

describe("dropSeasonReminders", () => {
  it("deletes every setting of the seasons and keeps other seasons", async () => {
    const app = await seeded();
    await app.uow.transaction(async (repos) => {
      await dropSeasonReminders(repos, [SEASON]);
      return ok(undefined);
    });
    expect(await app.reminders.listEnabled(SEASON)).toEqual([]);
    expect(await app.reminders.listEnabled(OTHER_SEASON)).toHaveLength(1);
  });
});
