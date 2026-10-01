import { ConcurrencyConflict, type Habit, habitId, instant, ok, userId } from "@pactjoy/app";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

const habit = (n: number): Habit => ({
  id: habitId(`00000000-0000-4000-8000-0000000000d${n}`),
  ownerId: userId("00000000-0000-4000-8000-0000000000b1"),
  name: `Habit ${n}`,
  why: null,
  category: null,
  createdAt: instant(1_700_000_000_000),
  version: 0,
});
const [A, B] = [habit(1), habit(2)] as const;

// Pool >= 2: the deadlock test needs two transactions in flight at once.
const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
// `exec` exposes the transaction's own executor, to ask Postgres about itself.
const bind = (exec: Parameters<typeof bindRepositories>[0]) => ({
  ...bindRepositories(exec),
  exec,
});
const uow = createUnitOfWork(client.begin, bind);
afterAll(async () => {
  await client.end();
  await admin.end();
});
beforeEach(() => truncateAll(admin));

const show = async (exec: ReturnType<typeof bind>["exec"], setting: string) =>
  (await exec.query<Record<string, string>>(`show ${setting}`, [])).rows[0]?.[setting];

/** A gate the test opens by hand. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Rejects instead of hanging forever, so a stuck lock fails the test. */
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);

describe("isolation levels", () => {
  it("UW-S11: transaction runs at read committed", async () => {
    const level = await uow.transaction(async ({ exec }) =>
      ok(await show(exec, "transaction_isolation")),
    );

    expect(level).toEqual(ok("read committed"));
  });

  it("UW-S29: read runs at repeatable read, read only", async () => {
    const [level, readOnly] = await uow.read(async ({ exec }) => [
      await show(exec, "transaction_isolation"),
      await show(exec, "transaction_read_only"),
    ]);

    expect(level).toBe("repeatable read");
    expect(readOnly).toBe("on");
  });

  it("UW-S26: two reads see one snapshot while another connection commits between them", async () => {
    const count = async ({ habits }: ReturnType<typeof bind>) => (await habits.get(A.id)) !== null;

    const [before, after] = await uow.read(async (repositories) => {
      const first = await count(repositories);
      await admin.unsafe(
        "insert into pactjoy.habits (id, owner_id, name, created_at, version) values ($1, $2, 'x', now(), 0)",
        [A.id, A.ownerId],
      );
      return [first, await count(repositories)] as const;
    });

    expect([before, after]).toEqual([false, false]);
    expect(await uow.read(count)).toBe(true);
  });

  it("UW-S27: a write inside read fails with 25006 and is not ConcurrencyConflict", async () => {
    const error = await uow.read(({ habits }) => habits.save(A, null)).catch((e) => e);

    expect(error).not.toBeInstanceOf(ConcurrencyConflict);
    expect(error).toMatchObject({ code: "25006" });
  });
});

describe("connection hygiene", () => {
  it("UW-S30: with max=1, ten failing transactions and reads leak no connection", async () => {
    const single = createClient({ url: databaseUrl(), max: 1 });
    const one = createUnitOfWork(single.begin, bindRepositories);
    try {
      for (let i = 0; i < 5; i++) {
        await one
          .transaction(async () => {
            throw new Error("boom");
          })
          .catch(() => undefined);
        await one.read(async ({ habits }) => habits.save(A, null)).catch(() => undefined);
      }

      const after = await within(
        one.transaction(async ({ habits }) => ok(await habits.get(A.id))),
        5_000,
      );
      expect(after).toEqual(ok(null));
    } finally {
      await single.end();
    }
  });
});

describe("retry on a real deadlock", () => {
  it("UW-S17: opposite lock order deadlocks once; the victim re-runs and both commit", async () => {
    await uow.transaction(async ({ habits }) => {
      await habits.save(A, null);
      await habits.save(B, null);
      return ok(undefined);
    });

    // Each transaction signals that it holds its first row, then waits for the
    // other's signal before reaching for the second. Only the FIRST attempt
    // waits: the re-run after the deadlock must not wait for anyone.
    const held = { first: deferred(), second: deferred() };
    const runs = { first: 0, second: 0 };

    const lockInOrder = (who: "first" | "second", own: Habit, other: Habit) =>
      uow.transaction(async ({ habits }) => {
        runs[who] += 1;
        const firstAttempt = runs[who] === 1;
        const mine = await habits.get(own.id);
        if (!mine) throw new Error("seed missing");
        await habits.save({ ...mine, version: mine.version + 1 }, mine.version);
        if (firstAttempt) {
          held[who].resolve();
          await within(held[who === "first" ? "second" : "first"].promise, 5_000);
        }
        const theirs = await habits.get(other.id);
        if (!theirs) throw new Error("seed missing");
        await habits.save({ ...theirs, version: theirs.version + 1 }, theirs.version);
        return ok(undefined);
      });

    try {
      const results = await within(
        Promise.all([lockInOrder("first", A, B), lockInOrder("second", B, A)]),
        20_000,
      );

      expect(results).toEqual([ok(undefined), ok(undefined)]);
      // One deadlock, one victim, exactly one re-run: 2 + 1 runs.
      expect(runs.first + runs.second).toBe(3);
      const versions = await admin.unsafe("select version from pactjoy.habits order by id");
      expect(versions.map((r) => r.version)).toEqual([2, 2]);
    } finally {
      // Never leave a waiter behind if an assertion fails before both settle.
      held.first.resolve();
      held.second.resolve();
    }
  });
});
