import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { circleId, seasonId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { type Deferred, deferred, delay } from "./deferred.ts";
import {
  CIRCLE,
  type ContractSubject,
  type GuardRepositories,
  SEASON,
  seedCircleAndSeason,
} from "./fixtures.ts";

type Subject = ContractSubject<GuardRepositories>;
type SubjectFactory = () => Promise<Subject>;

/** The one aggregate a guard suite exercises, seen only through the repositories. */
interface GuardTarget {
  get(repos: GuardRepositories): Promise<unknown>;
  version(repos: GuardRepositories): Promise<number | undefined>;
  guard(repos: GuardRepositories, expectedVersion: number): Promise<void>;
  guardMissing(repos: GuardRepositories): Promise<void>;
  /** Saves version 1 over the seeded version 0. */
  bump(repos: GuardRepositories): Promise<void>;
}

const CIRCLE_TARGET: GuardTarget = {
  get: (r) => r.circles.get(CIRCLE.id),
  version: async (r) => (await r.circles.get(CIRCLE.id))?.version,
  guard: (r, v) => r.circles.guardVersion(CIRCLE.id, v),
  guardMissing: (r) => r.circles.guardVersion(circleId("00000000-0000-4000-8000-0000000000ff"), 0),
  bump: (r) => r.circles.save({ ...CIRCLE, version: 1 }, 0),
};

const SEASON_TARGET: GuardTarget = {
  get: (r) => r.seasons.get(SEASON.id),
  version: async (r) => (await r.seasons.get(SEASON.id))?.version,
  guard: (r, v) => r.seasons.guardVersion(SEASON.id, v),
  guardMissing: (r) => r.seasons.guardVersion(seasonId("00000000-0000-4000-8000-0000000000ff"), 0),
  bump: (r) => r.seasons.save({ ...SEASON, version: 1 }, 0),
};

/**
 * The `guardVersion` contract (D5 read-set guard), adapter-neutral: every
 * case goes through `uow.transaction` / `uow.read` and asserts on how the
 * TRANSACTION settles, never on which call inside it throws (an adapter may
 * fail the guard eagerly or only at commit). No case awaits a write that
 * could be blocked while it holds a lock: a blocked writer is started,
 * left pending, and only awaited after the lock holder was released.
 */
/** Marks a pending promise as handled, so a late rejection never surfaces as an unhandled one. */
function quiet<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/**
 * Opens the gate and waits for every transaction to settle, even when an
 * assertion failed: a transaction left open on Postgres would keep its row
 * lock and block the next test's cleanup.
 */
async function drain(release: Deferred, ...pending: Promise<unknown>[]): Promise<void> {
  release.resolve();
  await Promise.allSettled(pending);
}

function defineGuardCases(factory: SubjectFactory, target: GuardTarget): void {
  async function setup(): Promise<Subject["uow"]> {
    const { uow } = await factory();
    await seedCircleAndSeason(uow);
    return uow;
  }
  const versionOf = (uow: Subject["uow"]) => uow.read((r) => target.version(r));
  const bumpInTransaction = (uow: Subject["uow"]) =>
    uow.transaction(async (r) => {
      await target.bump(r);
      return ok(undefined);
    });

  it("commits a guard whose version still matches", async () => {
    const uow = await setup();
    await uow.transaction(async (r) => {
      await target.guard(r, 0);
      return ok(undefined);
    });
  });

  it("rejects a guard whose expected version is AHEAD of the stored one, leaving no trace", async () => {
    const uow = await setup();
    const outcome = uow.transaction(async (r) => {
      await target.guard(r, 1);
      await target.bump(r);
      return ok(undefined);
    });
    await expect(outcome).rejects.toBeInstanceOf(ConcurrencyConflict);
    expect(await versionOf(uow)).toBe(0);
  });

  it("rejects a guard on an id that does not exist", async () => {
    const uow = await setup();
    const outcome = uow.transaction(async (r) => {
      await target.guardMissing(r);
      return ok(undefined);
    });
    await expect(outcome).rejects.toBeInstanceOf(ConcurrencyConflict);
  });

  it("lets one transaction guard and save the same aggregate: the guard checks the pre-write version", async () => {
    const uow = await setup();
    await uow.transaction(async (r) => {
      await target.guard(r, 0);
      await target.bump(r);
      return ok(undefined);
    });
    expect(await versionOf(uow)).toBe(1);
  });

  it("lets one transaction save then guard the pre-write version", async () => {
    const uow = await setup();
    await uow.transaction(async (r) => {
      await target.bump(r);
      await target.guard(r, 0);
      return ok(undefined);
    });
    expect(await versionOf(uow)).toBe(1);
  });

  it("rejects a stale guard once a concurrent transaction committed a newer version", async () => {
    const uow = await setup();
    const read = deferred();
    const release = deferred();
    const stale = quiet(
      uow.transaction(async (r) => {
        await target.get(r);
        read.resolve();
        await release.promise;
        await target.guard(r, 0);
        return ok(undefined);
      }),
    );
    try {
      await Promise.race([read.promise, stale]);
      // Safe to await: the stale transaction holds no lock yet.
      await bumpInTransaction(uow);
      release.resolve();
      await expect(stale).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await versionOf(uow)).toBe(1);
    } finally {
      await drain(release, stale);
    }
  });

  it("never loses an update: of two writers of the same version exactly one commits", async () => {
    const uow = await setup();
    const saved = deferred();
    const release = deferred();
    const first = quiet(
      uow.transaction(async (r) => {
        await target.guard(r, 0);
        await target.bump(r);
        saved.resolve();
        await release.promise;
        return ok(undefined);
      }),
    );
    let second: Promise<unknown> = Promise.resolve();
    try {
      await Promise.race([saved.promise, first]);
      second = quiet(bumpInTransaction(uow)); // may block on the first one's lock: do not await yet
      release.resolve();
      const settled = await Promise.allSettled([first, second]);
      expect(settled.map((s) => s.status).sort()).toEqual(["fulfilled", "rejected"]);
      const rejected = settled.find((s) => s.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
        ConcurrencyConflict,
      );
      expect(await versionOf(uow)).toBe(1);
    } finally {
      await drain(release, first, second);
    }
  });

  it("never commits a guard together with a write that got in before it", async () => {
    const uow = await setup();
    const guarded = deferred();
    const release = deferred();
    const guardOnly = quiet(
      uow.transaction(async (r) => {
        await target.guard(r, 0);
        guarded.resolve();
        await release.promise;
        return ok(undefined);
      }),
    );
    let writer: Promise<unknown> = Promise.resolve();
    try {
      await Promise.race([guarded.promise, guardOnly]);
      let released = false;
      let committedBeforeRelease = false;
      writer = quiet(
        bumpInTransaction(uow).then((result) => {
          committedBeforeRelease = !released;
          return result;
        }),
      );
      await delay(50); // only yields, so a free writer gets to run; the verdict is the flag
      released = true;
      release.resolve();
      const [guard, write] = await Promise.allSettled([guardOnly, writer]);
      // Either the writer waited for the guard (then both commit) or it got in
      // first (then the guard must fail): the guard never commits over it.
      expect(guard.status === "fulfilled" && committedBeforeRelease).toBe(false);
      if (guard.status === "fulfilled") expect(write.status).toBe("fulfilled");
      else expect(guard.reason).toBeInstanceOf(ConcurrencyConflict);
    } finally {
      await drain(release, guardOnly, writer);
    }
  });

  it("does nothing for a guard outside a transaction", async () => {
    const { uow } = await factory();
    await expect(uow.read((r) => target.guard(r, 5))).resolves.toBeUndefined();
  });
}

export function describeCircleGuardContract(name: string, factory: SubjectFactory): void {
  describe(`${name} circle repository: guardVersion`, () =>
    defineGuardCases(factory, CIRCLE_TARGET));
}

export function describeSeasonGuardContract(name: string, factory: SubjectFactory): void {
  describe(`${name} season repository: guardVersion`, () =>
    defineGuardCases(factory, SEASON_TARGET));
}
