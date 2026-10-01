import {
  type Circle,
  ConcurrencyConflict,
  circleId,
  instant,
  memberId,
  ok,
  userId,
} from "@pactjoy/app";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SqlExecutor } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = instant(1_700_000_000_000);
const memberOf = (n: number) => ({
  id: memberId(uuid(0x100 + n)),
  userId: userId(uuid(0x200 + n)),
  status: "active" as const,
  joinedAt: T0,
  leftAt: null,
});
const C: Circle = {
  id: circleId(uuid(0xc1)),
  name: "Circle",
  members: [memberOf(1)],
  invite: null,
  createdAt: T0,
  archivedAt: null,
  version: 0,
};

// Pool >= 2: every case keeps one transaction open while another runs.
const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
const statements: string[] = [];
const uow = createUnitOfWork(client.begin, (exec, mode) => {
  const spy: SqlExecutor = {
    query: (text, params) => {
      statements.push(text);
      return exec.query(text, params);
    },
  };
  return bindRepositories(spy, mode);
});
afterAll(async () => {
  await client.end();
  await admin.end();
});
const save = (c: Circle, expected: number | null) =>
  uow.transaction(async ({ circles }) => {
    await circles.save(c, expected);
    return ok(undefined);
  });
beforeEach(async () => {
  statements.length = 0;
  await save(C, null);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const delay = (ms: number) =>
  new Promise<"pending">((done) => setTimeout(() => done("pending"), ms));
/** Rejects instead of hanging, so a stuck lock fails the test. */
const within = <T>(promise: Promise<T>, ms = 3000) =>
  Promise.race([promise, delay(ms).then(() => Promise.reject(new Error("timed out")))]);
/** Whether `promise` is still unsettled after a short wait. */
const stillBlocked = async (promise: Promise<unknown>) =>
  (await Promise.race([
    promise.then(
      () => "settled",
      () => "settled",
    ),
    delay(150),
  ])) === "pending";

/** Holds a guard on C at `version` until `release()`; resolves `held` once the lock is taken. */
function holdGuard(version: number, alsoSave = false) {
  const held = deferred();
  const gate = deferred();
  const tx = uow.transaction(async ({ circles }) => {
    await circles.guardVersion(C.id, version);
    if (alsoSave) await circles.save({ ...C, version: version + 1 }, version);
    held.resolve();
    await gate.promise;
    return ok(undefined);
  });
  tx.catch(() => undefined);
  return { tx, gate, ready: () => Promise.race([held.promise, tx]) };
}

const bump = (to: number, expected: number) => save({ ...C, version: to }, expected);

describe("circle guardVersion on Postgres", () => {
  it("UW-S8: the guard locks the row until commit: another connection cannot take it", async () => {
    const a = holdGuard(0);
    try {
      await a.ready();
      for (const lock of ["for update", "for no key update"]) {
        const error = await admin
          .unsafe(`select 1 from pactjoy.circles where id = $1 ${lock} nowait`, [C.id])
          .catch((e) => e);
        expect(error).toMatchObject({ code: "55P03" });
      }
    } finally {
      a.gate.resolve();
      await Promise.allSettled([a.tx]);
    }
    await a.tx;
    await within(
      admin.unsafe("select 1 from pactjoy.circles where id = $1 for update nowait", [C.id]),
    );
  });

  it("the guard does not block an FK check (KEY SHARE), so a member insert commits under it", async () => {
    const a = holdGuard(0);
    try {
      await a.ready();
      await within(
        admin.unsafe(
          "insert into pactjoy.circle_members (id, circle_id, position, user_id, status, joined_at) values ($1, $2, 1, $3, 'active', now())",
          [memberOf(2).id, C.id, memberOf(2).userId],
        ),
      );
    } finally {
      a.gate.resolve();
      await Promise.allSettled([a.tx]);
    }
    await a.tx;
  });

  it("UW-S9: a stale or missing row fails at the guard call itself", async () => {
    await bump(1, 0);
    const outcome = await uow.transaction(async ({ circles }) => {
      const stale = await circles.guardVersion(C.id, 0).catch((e) => e);
      const missing = await circles.guardVersion(circleId(uuid(0xff)), 0).catch((e) => e);
      return ok({ stale, missing });
    });
    expect(outcome.ok && outcome.value.stale).toBeInstanceOf(ConcurrencyConflict);
    expect(outcome.ok && outcome.value.missing).toBeInstanceOf(ConcurrencyConflict);
  });

  it("a guard after this transaction's own write compares against the pre-write version", async () => {
    const guardAfterSave = (expected: number) =>
      uow.transaction(async ({ circles }) => {
        await circles.save({ ...C, version: 1 }, 0);
        await circles.guardVersion(C.id, expected);
        return ok(undefined);
      });
    await expect(guardAfterSave(1)).rejects.toBeInstanceOf(ConcurrencyConflict); // the NEW version is not the read-set
    await expect(guardAfterSave(7)).rejects.toBeInstanceOf(ConcurrencyConflict);
  });

  it("UW-S10: the guard SQL is FOR NO KEY UPDATE and no statement ever says FOR SHARE", async () => {
    await uow.transaction(async ({ circles }) => {
      await circles.guardVersion(C.id, 0);
      await circles.save({ ...C, version: 1 }, 0);
      return ok(undefined);
    });
    expect(statements.filter((s) => /for no key update/i.test(s))).toHaveLength(1);
    expect(
      statements.some((s) => /for share|for update/i.test(s.replace(/for no key update/gi, ""))),
    ).toBe(false);
  });

  it("UW-S13: a writer blocks behind the guard, then conflicts once the holder committed v1", async () => {
    const a = holdGuard(0, true);
    const b = a.ready().then(() => bump(1, 0));
    b.catch(() => undefined);
    let blocked = false;
    try {
      blocked = await stillBlocked(b);
    } finally {
      a.gate.resolve();
      await Promise.allSettled([a.tx, b]);
    }
    expect(blocked).toBe(true);
    await expect(b).rejects.toBeInstanceOf(ConcurrencyConflict);
    expect(await uow.read(({ circles }) => circles.get(C.id))).toMatchObject({ version: 1 });
  });

  it("UW-S14: a rolled-back guard releases the lock and the waiting writer succeeds", async () => {
    const held = deferred();
    const gate = deferred();
    const a = uow.transaction(async ({ circles }) => {
      await circles.guardVersion(C.id, 0);
      held.resolve();
      await gate.promise;
      return { ok: false as const, error: "stop" };
    });
    a.catch(() => undefined);
    let b: Promise<unknown> = Promise.resolve();
    try {
      await Promise.race([held.promise, a]);
      b = bump(1, 0);
      b.catch(() => undefined);
      expect(await stillBlocked(b)).toBe(true);
    } finally {
      gate.resolve();
      await Promise.allSettled([a, b]);
    }
    await expect(b).resolves.toBeDefined();
    expect(await uow.read(({ circles }) => circles.get(C.id))).toMatchObject({ version: 1 });
  });

  it("UW-S15: two guard+save of the same version: one commits, the other conflicts, no deadlock", async () => {
    const both = [1, 2].map((n) =>
      uow.transaction(async ({ circles }) => {
        await circles.guardVersion(C.id, 0);
        await circles.save({ ...C, name: `by ${n}`, version: 1 }, 0);
        return ok(undefined);
      }),
    );
    const settled = await within(Promise.allSettled(both), 10_000);
    expect(settled.map((s) => s.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = settled.find((s) => s.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(ConcurrencyConflict);
  });
});
