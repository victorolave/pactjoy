import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { CommitmentReminder } from "../reminders/commitment-reminder.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { seasonId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { instant } from "../time/instant.ts";
import type { ContractSubject } from "./fixtures.ts";

type ReminderRepositories = Pick<Repositories, "reminders">;

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = 1_791_987_120_000;
const SEASON = seasonId(uuid(0xe1));
const OTHER_SEASON = seasonId(uuid(0xe2));
const ANDREA = memberId(uuid(0xa1));

const reminder = (n: number, extra: Partial<CommitmentReminder> = {}): CommitmentReminder => ({
  seasonId: SEASON,
  commitmentId: commitmentId(uuid(0x600 + n)),
  memberId: ANDREA,
  enabled: true,
  minuteOfDay: 20 * 60,
  weekdays: [1, 3, 5],
  updatedAt: instant(T0 + n),
  version: 1,
  ...extra,
});

/**
 * `CommitmentReminderRepository` contract (ADR-0017 addendum, D2), adapter-neutral, driven through
 * the unit of work. The factory must return an EMPTY store. Reminders have no foreign keys (the
 * planner skips one whose season or commitment is gone), so nothing needs seeding.
 */
export function describeCommitmentReminderContract(
  name: string,
  factory: () => Promise<ContractSubject<ReminderRepositories>>,
): void {
  describe(`CommitmentReminderRepository contract (${name})`, () => {
    async function subject() {
      const { uow } = await factory();
      const save = (value: CommitmentReminder, expected: number | null) =>
        uow.transaction(async ({ reminders }) => {
          await reminders.save(value, expected);
          return ok(undefined);
        });
      return {
        save,
        get: (n: number, season = SEASON) =>
          uow.read(({ reminders }) => reminders.get(season, reminder(n).commitmentId)),
        enabled: (season = SEASON) => uow.read(({ reminders }) => reminders.listEnabled(season)),
      };
    }

    it("has no setting for a commitment never configured", async () => {
      const s = await subject();
      expect(await s.get(1)).toBeNull();
    });

    it("stores a setting and reads it back as given", async () => {
      const s = await subject();
      await s.save(reminder(1), null);
      expect(await s.get(1)).toEqual(reminder(1));
    });

    it("keeps the weekdays sorted and every day of the week representable", async () => {
      const s = await subject();
      await s.save(reminder(1, { weekdays: [0, 1, 2, 3, 4, 5, 6] }), null);
      await s.save(reminder(2, { weekdays: [6] }), null);
      expect((await s.get(1))?.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect((await s.get(2))?.weekdays).toEqual([6]);
    });

    it("updates with the stored version and bumps nothing else", async () => {
      const s = await subject();
      await s.save(reminder(1), null);
      const next = reminder(1, { enabled: false, minuteOfDay: 8 * 60, version: 2 });
      await s.save(next, 1);
      expect(await s.get(1)).toEqual(next);
    });

    it("rejects a stale version and a second insert of the same commitment", async () => {
      const s = await subject();
      await s.save(reminder(1), null);
      await expect(s.save(reminder(1, { version: 2 }), null)).rejects.toThrow(ConcurrencyConflict);
      await expect(s.save(reminder(1, { version: 3 }), 2)).rejects.toThrow(ConcurrencyConflict);
      expect(await s.get(1)).toEqual(reminder(1));
    });

    it("lists only the season's enabled reminders, ordered by commitment", async () => {
      const s = await subject();
      await s.save(reminder(3), null);
      await s.save(reminder(1), null);
      await s.save(reminder(2, { enabled: false }), null);
      await s.save(reminder(4, { seasonId: OTHER_SEASON }), null);
      expect((await s.enabled()).map((r) => r.commitmentId)).toEqual([
        reminder(1).commitmentId,
        reminder(3).commitmentId,
      ]);
      expect(await s.enabled(OTHER_SEASON)).toEqual([reminder(4, { seasonId: OTHER_SEASON })]);
    });
  });
}
