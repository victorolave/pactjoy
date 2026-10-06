import { describe, expect, it } from "vitest";
import type { Habit } from "../habit/habit.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { habitId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { instant } from "../time/instant.ts";
import { type ContractSubject, HABIT, type HabitRepositories } from "./fixtures.ts";

type Uow = ContractSubject<HabitRepositories>["uow"];

/** Saves in its own transaction; a lost race surfaces as the transaction rejecting. */
export function saveHabit(uow: Uow, habit: Habit, expected: number | null): Promise<unknown> {
  return uow.transaction(async ({ habits }) => {
    await habits.save(habit, expected);
    return ok(undefined);
  });
}

export const readHabit = (uow: Uow) => uow.read(({ habits }) => habits.get(HABIT.id));

/**
 * `HabitRepository` contract (HP-S1..S7, S9, S10), adapter-neutral: driven only
 * through `uow.transaction` / `uow.read`. The factory must return an EMPTY store.
 */
export function describeHabitRepositoryContract(
  name: string,
  factory: () => Promise<ContractSubject<HabitRepositories>>,
): void {
  describe(`HabitRepository contract (${name})`, () => {
    it("get returns null for an unknown id", async () => {
      const { uow } = await factory();
      expect(await readHabit(uow)).toBeNull();
    });

    it("save(null) inserts and get returns the same habit, nulls included", async () => {
      const { uow } = await factory();
      await saveHabit(uow, HABIT, null);
      expect(await readHabit(uow)).toEqual(HABIT);
    });

    it("save(null) over an existing id conflicts and leaves the stored row unchanged", async () => {
      const { uow } = await factory();
      await saveHabit(uow, HABIT, null);
      await expect(saveHabit(uow, { ...HABIT, name: "other" }, null)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      expect(await readHabit(uow)).toEqual(HABIT);
    });

    it("save at the expected version updates every field and takes the new version", async () => {
      const { uow } = await factory();
      await saveHabit(uow, HABIT, null);
      const next = { ...HABIT, name: "Run", why: "health", category: "sport", version: 1 };
      await saveHabit(uow, next, 0);
      expect(await readHabit(uow)).toEqual(next);
    });

    it("save at a stale expected version conflicts and leaves the stored row unchanged", async () => {
      const { uow } = await factory();
      await saveHabit(uow, HABIT, null);
      const v1 = { ...HABIT, name: "v1", version: 1 };
      await saveHabit(uow, v1, 0);
      await expect(
        saveHabit(uow, { ...HABIT, name: "late", version: 1 }, 0),
      ).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await readHabit(uow)).toEqual(v1);
    });

    it("save with an expected version over a missing row conflicts", async () => {
      const { uow } = await factory();
      await expect(saveHabit(uow, HABIT, 0)).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await readHabit(uow)).toBeNull();
    });

    it("round-trips milliseconds, unicode and emoji, and tells empty text from null", async () => {
      const { uow } = await factory();
      const habit = {
        ...HABIT,
        name: "Leer 📚 ñandú",
        why: "",
        category: null,
        createdAt: instant(1_700_000_000_123),
      };
      await saveHabit(uow, habit, null);
      expect(await readHabit(uow)).toEqual(habit);
    });

    it("round-trips an icon key and a null icon", async () => {
      const { uow } = await factory();
      const withIcon = { ...HABIT, icon: "book-open" };
      await saveHabit(uow, withIcon, null);
      expect(await readHabit(uow)).toEqual(withIcon);
      const cleared = { ...withIcon, icon: null, version: 1 };
      await saveHabit(uow, cleared, 0);
      expect(await readHabit(uow)).toEqual(cleared);
    });

    describe("listByOwner", () => {
      const OTHER_OWNER = userId("00000000-0000-4000-8000-0000000000b2");
      const OLD = { ...HABIT, id: habitId("00000000-0000-4000-8000-0000000000e1") };
      const NEW = {
        ...HABIT,
        id: habitId("00000000-0000-4000-8000-0000000000e2"),
        createdAt: instant(1_700_000_005_000),
      };
      const FOREIGN = {
        ...HABIT,
        id: habitId("00000000-0000-4000-8000-0000000000e3"),
        ownerId: OTHER_OWNER,
      };

      it("returns only the owner's habits, newest first", async () => {
        const { uow } = await factory();
        await saveHabit(uow, OLD, null);
        await saveHabit(uow, FOREIGN, null);
        await saveHabit(uow, NEW, null);
        const mine = await uow.read(({ habits }) => habits.listByOwner(HABIT.ownerId));
        expect(mine).toEqual([NEW, OLD]);
      });

      it("returns [] for an owner with no habits", async () => {
        const { uow } = await factory();
        await saveHabit(uow, FOREIGN, null);
        expect(await uow.read(({ habits }) => habits.listByOwner(HABIT.ownerId))).toEqual([]);
      });

      it("breaks equal createdAt ties by id ascending, not insertion order", async () => {
        const { uow } = await factory();
        const tied = { ...NEW, createdAt: OLD.createdAt };
        await saveHabit(uow, tied, null);
        await saveHabit(uow, OLD, null);
        expect(await uow.read(({ habits }) => habits.listByOwner(HABIT.ownerId))).toEqual([
          OLD,
          tied,
        ]);
      });
    });

    describe("getMany (HG-S1..S3)", () => {
      const H2 = { ...HABIT, id: habitId("00000000-0000-4000-8000-0000000000d2"), name: "Two" };
      const H3 = { ...HABIT, id: habitId("00000000-0000-4000-8000-0000000000d3"), name: "Three" };
      const UNKNOWN = habitId("00000000-0000-4000-8000-0000000000d9");
      const byId = (a: Habit, b: Habit) => a.id.localeCompare(b.id);

      async function seed(uow: Uow): Promise<void> {
        await saveHabit(uow, HABIT, null);
        await saveHabit(uow, H2, null);
        await saveHabit(uow, H3, null);
      }

      it("HG-S1 returns the habits that exist and skips unknown ids", async () => {
        const { uow } = await factory();
        await seed(uow);
        const found = await uow.read(({ habits }) => habits.getMany([HABIT.id, UNKNOWN, H3.id]));
        expect([...found].sort(byId)).toEqual([HABIT, H3]);
      });

      it("HG-S2 returns [] for no ids", async () => {
        const { uow } = await factory();
        await seed(uow);
        expect(await uow.read(({ habits }) => habits.getMany([]))).toEqual([]);
      });

      it("HG-S3 returns each habit once when ids repeat", async () => {
        const { uow } = await factory();
        await seed(uow);
        const found = await uow.read(({ habits }) =>
          habits.getMany([H2.id, H2.id, HABIT.id, H2.id]),
        );
        expect([...found].sort(byId)).toEqual([HABIT, H2]);
      });

      it("returns [] when every id is unknown", async () => {
        const { uow } = await factory();
        expect(await uow.read(({ habits }) => habits.getMany([UNKNOWN]))).toEqual([]);
      });

      it("inside a transaction it sees its own staged writes over the store", async () => {
        const { uow } = await factory();
        await saveHabit(uow, HABIT, null);
        const seen = await uow.transaction(async ({ habits }) => {
          await habits.save(H2, null);
          return ok(await habits.getMany([HABIT.id, H2.id]));
        });
        expect([...(seen as { value: readonly Habit[] }).value].sort(byId)).toEqual([HABIT, H2]);
      });
    });
  });
}
