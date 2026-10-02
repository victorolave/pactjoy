import {
  type Circle,
  ConcurrencyConflict,
  circleId,
  instant,
  inviteCode,
  memberId,
  ok,
  userId,
} from "@pactjoy/app";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = instant(1_700_000_000_000);

const member = (n: number) => ({
  id: memberId(uuid(0x100 + n)),
  userId: userId(uuid(0x200 + n)),
  status: "active" as const,
  joinedAt: T0,
  leftAt: null,
});
const invite = (code: string, by: number, expiresAt = instant(T0 + 600_000)) => ({
  code: inviteCode(code),
  createdAt: T0,
  expiresAt,
  createdBy: member(by).id,
});
const circle = (n: number, extra: Partial<Circle> = {}): Circle => ({
  id: circleId(uuid(0xc0 + n)),
  name: `Circle ${n}`,
  members: [member(n)],
  invite: null,
  createdAt: T0,
  archivedAt: null,
  version: 0,
  ...extra,
});

// Pool >= 2: the deadlock regression keeps one transaction open while another runs.
const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
afterAll(async () => {
  await client.end();
  await admin.end();
});

const save = (c: Circle, expected: number | null) =>
  uow.transaction(async ({ circles }) => {
    await circles.save(c, expected);
    return ok(undefined);
  });
const load = (c: Circle) => uow.read(({ circles }) => circles.get(c.id));

/** Rejects instead of hanging, so a stuck lock fails the test. */
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);

const rawInsertMember = (c: Circle, n: number, position: number) =>
  admin.unsafe(
    "insert into pactjoy.circle_members (id, circle_id, position, user_id, status, joined_at) values ($1, $2, $3, $4, 'active', now())",
    [member(n).id, c.id, position, member(n).userId],
  );

describe("circle repository on Postgres", () => {
  it("CP-S7: members come back by position, not by physical row order", async () => {
    const c = circle(1, { members: [] });
    await save(c, null);
    // Physical order is the reverse of position, then churned by updates.
    for (const n of [3, 2, 1]) await rawInsertMember(c, n, n - 1);
    await admin.unsafe("update pactjoy.circle_members set left_at = null where position = 0");
    expect((await load(c))?.members.map((m) => m.id)).toEqual([1, 2, 3].map((n) => member(n).id));
  });

  it("CP-S8: equal positions in one circle are rejected as a raw error", async () => {
    const c = circle(1);
    await save(c, null);
    const error = await rawInsertMember(c, 2, 0).catch((e) => e);
    expect(error).toMatchObject({ code: "23505", constraint_name: "circle_members_position_key" });
  });

  it("CP-S22: a raw second active row for one user is rejected on circle_members_active_user_key", async () => {
    const a = circle(1);
    const b = circle(2, { members: [] });
    await save(a, null);
    await save(b, null);
    const error = await admin
      .unsafe(
        "insert into pactjoy.circle_members (id, circle_id, position, user_id, status, joined_at) values ($1, $2, 0, $3, 'active', now())",
        [member(9).id, b.id, member(1).userId],
      )
      .catch((e) => e);
    expect(error).toMatchObject({
      code: "23505",
      constraint_name: "circle_members_active_user_key",
    });
  });

  it("CP-S23: a left row plus an active row, and several left rows, are allowed for one user", async () => {
    const a = circle(1, { members: [] });
    const b = circle(2, { members: [] });
    const c = circle(3, { members: [] });
    for (const x of [a, b, c]) await save(x, null);
    const insert = (n: number, circleRow: Circle, status: "active" | "left") =>
      admin.unsafe(
        "insert into pactjoy.circle_members (id, circle_id, position, user_id, status, joined_at, left_at) values ($1, $2, 0, $3, $4, now(), case when $4 = 'left' then now() end)",
        [member(n).id, circleRow.id, member(1).userId, status],
      );
    await insert(11, a, "left");
    await insert(12, b, "left");
    await insert(13, c, "active");
    const rows = await admin.unsafe(
      "select count(*)::int as n from pactjoy.circle_members where user_id = $1",
      [member(1).userId],
    );
    expect(rows[0]?.n).toBe(3);
  });

  it("CP-S25: the active-user index is unique and partial, and the old non-unique one is gone", async () => {
    const rows = await admin.unsafe(
      "select indexname, indexdef from pg_indexes where schemaname = 'pactjoy' and tablename = 'circle_members' and indexname in ('circle_members_active_user_key', 'circle_members_active_user_idx')",
    );
    expect(rows.map((r) => r.indexname)).toEqual(["circle_members_active_user_key"]);
    expect(rows[0]?.indexdef).toContain("CREATE UNIQUE INDEX");
    expect(rows[0]?.indexdef).toContain("WHERE (status = 'active'");
  });

  it("a member is left exactly when left_at is set (circle_members_left_at_check)", async () => {
    const c = circle(1);
    await save(c, null);
    const insert = (status: string, leftAt: string | null) =>
      admin
        .unsafe(
          "insert into pactjoy.circle_members (id, circle_id, position, user_id, status, joined_at, left_at) values ($1, $2, 1, $3, $4, now(), $5::timestamptz)",
          [member(2).id, c.id, member(2).userId, status, leftAt],
        )
        .catch((e) => e);
    for (const [status, leftAt] of [
      ["left", null],
      ["active", "2023-11-14T00:00:00Z"],
    ] as const) {
      expect(await insert(status, leftAt)).toMatchObject({
        code: "23514",
        constraint_name: "circle_members_left_at_check",
      });
    }
  });

  it("CP-S12: a save that conflicts halfway leaves members and invite unchanged", async () => {
    const a = circle(1, { invite: invite("TAKEN1", 1) });
    const b = circle(2, { invite: invite("OWN222", 2) });
    await save(a, null);
    await save(b, null);
    // B's update replaces members, then collides on A's code: the whole save rolls back.
    const clash = {
      ...b,
      members: [member(3), member(4)],
      invite: invite("TAKEN1", 3),
      version: 1,
    };
    await expect(save(clash, 0)).rejects.toBeInstanceOf(ConcurrencyConflict);
    expect(await load(b)).toEqual(b);
    // A stale save leaves everything as it was too.
    await expect(save({ ...clash, version: 9 }, 7)).rejects.toBeInstanceOf(ConcurrencyConflict);
    expect(await load(b)).toEqual(b);
  });

  it("CP-S15 / UW-S19: a duplicate invite code is a ConcurrencyConflict, expired or not", async () => {
    await save(circle(1, { invite: invite("DUP111", 1) }), null);
    await expect(save(circle(2, { invite: invite("DUP111", 2) }), null)).rejects.toBeInstanceOf(
      ConcurrencyConflict,
    );
    // Accepted divergence (ADR-0010): the unique key also covers EXPIRED codes,
    // so reusing one conflicts where the in-memory adapter would allow it.
    await save(circle(3, { invite: invite("OLD333", 3, instant(1)) }), null);
    await expect(save(circle(4, { invite: invite("OLD333", 4) }), null)).rejects.toBeInstanceOf(
      ConcurrencyConflict,
    );
  });

  it("CP-S19 / CP-S20: children reference circles with RESTRICT and members have no user FK", async () => {
    const c = circle(1, { invite: invite("KEEP11", 1) });
    await save(c, null);
    const fks = await admin.unsafe(
      `select conrelid::regclass::text as tbl, confrelid::regclass::text as target, confdeltype
         from pg_constraint where contype = 'f' and conrelid::regclass::text like 'pactjoy.circle_%'
         order by 1`,
    );
    expect(fks.map((f) => [f.tbl, f.target, f.confdeltype])).toEqual([
      ["pactjoy.circle_invites", "pactjoy.circles", "r"],
      ["pactjoy.circle_members", "pactjoy.circles", "r"],
    ]);
    const error = await admin
      .unsafe("delete from pactjoy.circles where id = $1", [c.id])
      .catch((e) => e);
    expect(error).toMatchObject({ code: "23503" });
    expect(await load(c)).toEqual(c);
  });
});

describe("circle save versus a concurrent foreign-key check", () => {
  it("regenerating the invite never waits on a KEY SHARE holder: no deadlock, no retry", async () => {
    const c = circle(1, { invite: invite("OLD999", 1) });
    await save(c, null);

    // A season insert's FK check holds KEY SHARE on the circle row until it commits.
    const locked = deferred();
    const release = deferred();
    const holder = admin.begin(async (tx) => {
      await tx.unsafe("select 1 from pactjoy.circles where id = $1 for key share", [c.id]);
      locked.resolve();
      await release.promise;
    });
    holder.catch(() => undefined);

    let runs = 0;
    try {
      await within(locked.promise, 5_000);
      const next = { ...c, name: "renamed", invite: invite("NEW999", 1), version: 1 };
      // The save must finish while the holder is STILL open: it touches no key column.
      const result = await within(
        uow.transaction(async ({ circles }) => {
          runs += 1;
          await circles.save(next, 0);
          return ok(undefined);
        }),
        5_000,
      );
      expect(result).toEqual(ok(undefined));
      expect(runs).toBe(1);
    } finally {
      release.resolve();
    }
    await within(holder, 5_000);
    expect(await load(c)).toMatchObject({
      name: "renamed",
      invite: { code: "NEW999" },
      version: 1,
    });
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
