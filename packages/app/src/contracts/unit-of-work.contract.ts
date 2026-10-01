import { describe, expect, it } from "vitest";
import { err, ok } from "../shared/result.ts";
import { deferred } from "./deferred.ts";
import { type ContractSubject, HABIT, type HabitRepositories } from "./fixtures.ts";
import { readHabit } from "./habit.contract.ts";

/**
 * `UnitOfWork` contract over the habit repository (UW-S1..S3, S7, S28),
 * adapter-neutral. The multi-repository cases (UW-S4..S6) need circles and
 * seasons and arrive with them. A database factory MUST give a pool of >= 2
 * connections: UW-S7 reads while a transaction is still open.
 */
export function describeUnitOfWorkContract(
  name: string,
  factory: () => Promise<ContractSubject<HabitRepositories>>,
): void {
  describe(`UnitOfWork contract (${name})`, () => {
    it("commits the writes when work resolves ok, and returns its result", async () => {
      const { uow } = await factory();
      const result = await uow.transaction(async ({ habits }) => {
        await habits.save(HABIT, null);
        return ok("done");
      });
      expect(result).toEqual(ok("done"));
      expect(await readHabit(uow)).toEqual(HABIT);
    });

    it("rolls the writes back when work resolves err, and returns that err", async () => {
      const { uow } = await factory();
      const result = await uow.transaction(async ({ habits }) => {
        await habits.save(HABIT, null);
        return err("nope");
      });
      expect(result).toEqual(err("nope"));
      expect(await readHabit(uow)).toBeNull();
    });

    it("rolls the writes back and rethrows the same error when work throws", async () => {
      const { uow } = await factory();
      const boom = new Error("x");
      await expect(
        uow.transaction(async ({ habits }) => {
          await habits.save(HABIT, null);
          throw boom;
        }),
      ).rejects.toBe(boom);
      expect(await readHabit(uow)).toBeNull();
    });

    it("lets a transaction read its own writes while others do not see them until commit", async () => {
      const { uow } = await factory();
      const saved = deferred();
      const release = deferred();
      const tx = uow.transaction(async ({ habits }) => {
        await habits.save(HABIT, null);
        const own = await habits.get(HABIT.id);
        saved.resolve();
        await release.promise;
        return ok(own);
      });
      tx.catch(() => undefined);
      try {
        await Promise.race([saved.promise, tx]);
        expect(await readHabit(uow)).toBeNull();
      } finally {
        release.resolve();
      }
      expect(await tx).toEqual(ok(HABIT));
      expect(await readHabit(uow)).toEqual(HABIT);
    });

    it("read passes the value through and rejects when work throws", async () => {
      const { uow } = await factory();
      expect(await uow.read(async () => 42)).toBe(42);
      await expect(
        uow.read(async () => {
          throw new Error("read failed");
        }),
      ).rejects.toThrow("read failed");
    });
  });
}
