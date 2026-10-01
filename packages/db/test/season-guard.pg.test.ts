import {
  ConcurrencyConflict,
  circleId,
  instant,
  localDate,
  memberId,
  ok,
  type Season,
  seasonId,
  timeZoneId,
  userId,
} from "@pactjoy/app";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SqlExecutor } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = instant(1_700_000_000_000);
const CIRCLE = {
  id: circleId(uuid(0xc1)),
  name: "Circle",
  members: [
    {
      id: memberId(uuid(0x101)),
      userId: userId(uuid(0x201)),
      status: "active" as const,
      joinedAt: T0,
      leftAt: null,
    },
  ],
  invite: null,
  createdAt: T0,
  archivedAt: null,
  version: 0,
};
const S: Season = {
  id: seasonId(uuid(0xe1)),
  circleId: CIRCLE.id,
  timeZone: timeZoneId("America/Bogota"),
  nominalStart: localDate("2026-10-01"),
  actualStart: null,
  lengthWeeks: 8,
  reviewCadenceWeeks: 2,
  status: "pactOpen",
  commitments: [],
  approvals: [],
  pactClosedAt: null,
  pactRevision: 0,
  createdAt: T0,
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
beforeEach(async () => {
  await uow.transaction(async ({ circles, seasons }) => {
    await circles.save(CIRCLE, null);
    await seasons.save(S, null);
    return ok(undefined);
  });
  statements.length = 0;
});

const delay = (ms: number) =>
  new Promise<"pending">((done) => setTimeout(() => done("pending"), ms));
/** Rejects instead of hanging, so a stuck lock fails the test. */
const within = <T>(promise: Promise<T>, ms = 3000) =>
  Promise.race([promise, delay(ms).then(() => Promise.reject(new Error("timed out")))]);
const stillBlocked = async (promise: Promise<unknown>) =>
  (await Promise.race([
    promise.then(
      () => "settled",
      () => "settled",
    ),
    delay(150),
  ])) === "pending";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Guards S at v0 (optionally saving v1 too) until `release()`; `ready()` resolves once the lock is held. */
function holdGuard(options: { save: boolean; outcome?: "ok" | "err" }) {
  const release = gate();
  const held = gate();
  const tx = uow.transaction<undefined, string>(async ({ seasons }) => {
    await seasons.guardVersion(S.id, 0);
    if (options.save) await seasons.save({ ...S, version: 1 }, 0);
    held.open();
    await release.promise;
    return options.outcome === "err" ? { ok: false as const, error: "stop" } : ok(undefined);
  });
  tx.catch(() => undefined);
  return { tx, release: release.open, ready: () => Promise.race([held.promise, tx]) };
}
const deleteS = (expected: number) =>
  uow.transaction(async ({ seasons }) => {
    await seasons.delete(S.id, expected);
    return ok(undefined);
  });

describe("season guardVersion on Postgres", () => {
  it("locks the row until commit, FOR NO KEY UPDATE, but not against an FK check (KEY SHARE)", async () => {
    const a = holdGuard({ save: false });
    try {
      await a.ready();
      for (const lock of ["for update", "for no key update"]) {
        const error = await admin
          .unsafe(`select 1 from pactjoy.seasons where id = $1 ${lock} nowait`, [S.id])
          .catch((e) => e);
        expect(error).toMatchObject({ code: "55P03" });
      }
      await within(
        admin.unsafe("select 1 from pactjoy.seasons where id = $1 for key share nowait", [S.id]),
      );
    } finally {
      a.release();
      await Promise.allSettled([a.tx]);
    }
    await a.tx;
  });

  it("the guard SQL is FOR NO KEY UPDATE and no statement ever says FOR SHARE", async () => {
    await uow.transaction(async ({ seasons }) => {
      await seasons.guardVersion(S.id, 0);
      await seasons.save({ ...S, version: 1 }, 0);
      return ok(undefined);
    });
    expect(statements.filter((s) => /for no key update/i.test(s))).toHaveLength(1);
    expect(
      statements.some((s) => /for share|for update/i.test(s.replace(/for no key update/gi, ""))),
    ).toBe(false);
  });

  it("SP-S27: a parallel delete blocks behind the guard, then conflicts once the holder saved v1", async () => {
    const a = holdGuard({ save: true });
    const b = a.ready().then(() => deleteS(0));
    b.catch(() => undefined);
    let blocked = false;
    try {
      blocked = await stillBlocked(b);
    } finally {
      a.release();
      await Promise.allSettled([a.tx, b]);
    }
    expect(blocked).toBe(true);
    await expect(b).rejects.toBeInstanceOf(ConcurrencyConflict);
    expect(await uow.read(({ seasons }) => seasons.get(S.id))).toMatchObject({ version: 1 });
  });

  it("a delete waiting behind a rolled-back guard then succeeds", async () => {
    const a = holdGuard({ save: false, outcome: "err" });
    let b: Promise<unknown> = Promise.resolve();
    try {
      await a.ready();
      b = deleteS(0);
      b.catch(() => undefined);
      expect(await stillBlocked(b)).toBe(true);
    } finally {
      a.release();
      await Promise.allSettled([a.tx, b]);
    }
    await b;
    expect(await uow.read(({ seasons }) => seasons.get(S.id))).toBeNull();
  });

  it("two guard+save of the same version: one commits, the other conflicts, no deadlock", async () => {
    const both = [1, 2].map(() =>
      uow.transaction(async ({ seasons }) => {
        await seasons.guardVersion(S.id, 0);
        await seasons.save({ ...S, version: 1 }, 0);
        return ok(undefined);
      }),
    );
    const settled = await within(Promise.allSettled(both), 10_000);
    expect(settled.map((s) => s.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = settled.find((s) => s.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(ConcurrencyConflict);
  });
});
