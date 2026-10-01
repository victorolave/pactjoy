import { describe, expect, it } from "vitest";
import type { Repositories } from "../ports/repositories.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { circleId } from "../shared/ids.ts";
import { err, ok } from "../shared/result.ts";
import { deferred } from "./deferred.ts";
import {
  CIRCLE,
  type ContractSubject,
  HABIT,
  type HabitRepositories,
  SEASON,
  seedCircleAndSeason,
} from "./fixtures.ts";
import { readHabit } from "./habit.contract.ts";

type UowRepositories = HabitRepositories & Pick<Repositories, "circles" | "seasons">;
const NEW_CIRCLE = { ...CIRCLE, id: circleId("00000000-0000-4000-8000-0000000000c9"), members: [] };

/**
 * `UnitOfWork` contract over the habit, circle and season repositories (UW-S1..S7,
 * S28), adapter-neutral. A database factory MUST give a pool of >= 2
 * connections: UW-S7 reads while a transaction is still open.
 */
export function describeUnitOfWorkContract(
  name: string,
  factory: () => Promise<ContractSubject<UowRepositories>>,
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

    const readBoth = (uow: UnitOfWorkOf, id = NEW_CIRCLE.id) =>
      uow.read(async ({ circles, seasons }) => ({
        circle: await circles.get(id),
        season: await seasons.get(SEASON.id),
      }));
    type UnitOfWorkOf = ContractSubject<UowRepositories>["uow"];
    const saveBoth = (uow: UnitOfWorkOf, outcome: "ok" | "err") =>
      uow.transaction(async ({ circles, seasons }) => {
        await circles.save(CIRCLE, null);
        await seasons.save(SEASON, null);
        return outcome === "ok" ? ok("done") : err("nope");
      });

    it("UW-S4: a circle and a season saved together are both rolled back on err", async () => {
      const { uow } = await factory();
      expect(await saveBoth(uow, "err")).toEqual(err("nope"));
      expect(await readBoth(uow, CIRCLE.id)).toEqual({ circle: null, season: null });
    });

    it("UW-S5: a conflicting season save rejects and leaves the circle written before it unsaved", async () => {
      const { uow } = await factory();
      await seedCircleAndSeason(uow);
      await expect(
        uow.transaction(async ({ circles, seasons }) => {
          await circles.save(NEW_CIRCLE, null);
          await seasons.save(SEASON, null);
          return ok(undefined);
        }),
      ).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect((await readBoth(uow)).circle).toBeNull();
    });

    it("UW-S6: on ok both persist together", async () => {
      const { uow } = await factory();
      expect(await saveBoth(uow, "ok")).toEqual(ok("done"));
      expect(await readBoth(uow, CIRCLE.id)).toEqual({ circle: CIRCLE, season: SEASON });
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
