import {
  type Circle,
  type CommitmentRecord,
  ConcurrencyConflict,
  circleId,
  commitmentId,
  habitId,
  instant,
  inviteCode,
  localDate,
  memberId,
  ok,
  type Season,
  seasonId,
  timeZoneId,
  userId,
} from "@pactjoy/app";
import { frac } from "@pactjoy/engine";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = instant(1_700_000_000_000);
const MEMBER = memberId(uuid(0x101));

const circle: Circle = {
  id: circleId(uuid(0xc1)),
  name: "Circle",
  members: [
    { id: MEMBER, userId: userId(uuid(0x201)), status: "active", joinedAt: T0, leftAt: null },
  ],
  invite: null,
  createdAt: T0,
  archivedAt: null,
  version: 0,
};
const season: Season = {
  id: seasonId(uuid(0xe1)),
  circleId: circle.id,
  timeZone: timeZoneId("America/Bogota"),
  nominalStart: localDate("2026-10-01"),
  actualStart: null,
  lengthWeeks: 8,
  reviewCadenceWeeks: 2,
  status: "pactOpen",
  commitments: [],
  approvals: [],
  pactClosedAt: null,
  createdAt: T0,
  version: 0,
};

const commitment: CommitmentRecord = {
  id: commitmentId(uuid(0x301)),
  memberId: MEMBER,
  habitId: habitId(uuid(0x401)),
  weightPercent: 100,
  privacy: "visible",
  measure: {
    unit: "done",
    schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
  },
};
const approval = { memberId: MEMBER, approvedAt: T0 };
const withChildren: Season = { ...season, commitments: [commitment], approvals: [approval] };

// Pool >= 2: the lock regression keeps one transaction open while another runs.
const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
// Same unit of work, but every transaction runs in a non-UTC session time zone (SP-S23).
const tzUow = createUnitOfWork(
  (isolation, work) =>
    client.begin(isolation, async (tx) => {
      await tx.query("set local timezone = 'Pacific/Kiritimati'", []);
      return work(tx);
    }),
  bindRepositories,
);
const save = (s: Season, expected: number | null) =>
  uow.transaction(async ({ seasons }) => {
    await seasons.save(s, expected);
    return ok(undefined);
  });
const count = async (table: string) =>
  Number((await admin.unsafe(`select count(*) as n from pactjoy.${table}`))[0]?.n);
afterAll(async () => {
  await client.end();
  await admin.end();
});
beforeEach(async () => {
  await truncateAll(admin);
  await uow.transaction(async ({ circles }) => {
    await circles.save(circle, null);
    return ok(undefined);
  });
});

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);

describe("season repository on Postgres (read/write side)", () => {
  it("stores the measure as a jsonb object (not a double-encoded string) tagged with its version", async () => {
    await save({ ...season, commitments: [commitment] }, null);
    const rows = await admin.unsafe(
      "select jsonb_typeof(measure) as type, (measure->>'v')::int as v from pactjoy.season_commitments",
    );
    expect(rows).toEqual([{ type: "object", v: 1 }]);
  });

  it("a commitment id is unique across seasons (season_commitments_id_key), raised as a raw 23505", async () => {
    await save({ ...season, commitments: [commitment] }, null);
    const error = await save(
      { ...season, id: seasonId(uuid(0xe2)), commitments: [commitment] },
      null,
    ).catch((e) => e);
    expect(error).toMatchObject({ code: "23505", constraint_name: "season_commitments_id_key" });
  });

  it("SP-S7: a conflicting save leaves the stored children untouched", async () => {
    await save(withChildren, null);
    await expect(
      save({ ...withChildren, version: 1, commitments: [], approvals: [] }, 7),
    ).rejects.toBeInstanceOf(ConcurrencyConflict);
    expect([await count("season_commitments"), await count("season_approvals")]).toEqual([1, 1]);
  });

  it("SP-S15: delete cascades to every child row", async () => {
    await save(withChildren, null);
    await uow.transaction(async ({ seasons }) => {
      await seasons.delete(season.id, 0);
      return ok(undefined);
    });
    expect([await count("seasons"), await count("season_commitments")]).toEqual([0, 0]);
    expect(await count("season_approvals")).toBe(0);
  });

  it("SP-S20: a corrupt stored measure fails the read and names the commitment", async () => {
    await save(withChildren, null);
    await admin.unsafe(`update pactjoy.season_commitments set measure = '{"v": 99}'::jsonb`);
    await expect(uow.read(({ seasons }) => seasons.get(season.id))).rejects.toThrow(
      `corrupt measure of commitment ${commitment.id}`,
    );
  });

  it("SP-S21: fractions are stored as decimal strings next to the version tag", async () => {
    const measure = {
      unit: "km" as const,
      customLabel: null,
      precision: "decimal" as const,
      target: { direction: "reach" as const, minimum: frac(1n, 3n), ideal: frac(2n ** 70n, 1n) },
      schedule: { period: "weeklyTotal" as const },
    };
    await save({ ...season, commitments: [{ ...commitment, measure }] }, null);
    const rows = await admin.unsafe(
      "select measure->'target'->'ideal' as ideal, measure->>'v' as v from pactjoy.season_commitments",
    );
    expect(rows).toEqual([{ ideal: { num: (2n ** 70n).toString(), den: "1" }, v: "1" }]);
  });

  it("SP-S23: dates and instants survive a non-UTC session time zone", async () => {
    const dated = { ...withChildren, actualStart: localDate("2026-12-31") };
    await tzUow.transaction(async ({ seasons }) => {
      await seasons.save(dated, null);
      return ok(undefined);
    });
    expect(await tzUow.read(({ seasons }) => seasons.get(season.id))).toEqual(dated);
    expect(await uow.read(({ seasons }) => seasons.get(season.id))).toEqual(dated);
  });

  it("SP-S26: the same member cannot approve twice (raw 23505, not a conflict)", async () => {
    const error = await save({ ...season, approvals: [approval, approval] }, null).catch((e) => e);
    expect(error).toMatchObject({ code: "23505", constraint_name: "season_approvals_member_key" });
  });

  it("SP-S28: a circle with seasons cannot be deleted (RESTRICT); status is stored as given", async () => {
    await save({ ...season, status: "closed", lengthWeeks: 12 }, null);
    await admin.unsafe("delete from pactjoy.circle_members"); // members RESTRICT the circle too
    const error = await admin
      .unsafe("delete from pactjoy.circles where id = $1", [circle.id])
      .catch((e) => e);
    expect(error).toMatchObject({ code: "23503", constraint_name: "seasons_circle_id_fkey" });
    expect(await admin.unsafe("select status, length_weeks from pactjoy.seasons")).toEqual([
      { status: "closed", length_weeks: 12 },
    ]);
  });

  it("a circle invite regenerated while a season insert is uncommitted never waits (KEY SHARE vs save)", async () => {
    const c = { ...circle, invite: null };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inserted!: () => void;
    const seasonInserted = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    // The season's FK check holds KEY SHARE on the circle row until this transaction commits.
    const holder = uow.transaction(async ({ seasons }) => {
      await seasons.save(season, null);
      inserted();
      await gate;
      return ok(undefined);
    });
    holder.catch(() => undefined);
    try {
      await within(seasonInserted, 5_000);
      const next = {
        ...c,
        version: 1,
        invite: {
          code: inviteCode("NEW999"),
          createdAt: T0,
          expiresAt: instant(T0 + 600_000),
          createdBy: MEMBER,
        },
      };
      await within(
        uow.transaction(async ({ circles }) => {
          await circles.save(next, 0);
          return ok(undefined);
        }),
        5_000,
      );
    } finally {
      release();
    }
    await within(holder, 5_000);
    expect(await uow.read(({ seasons }) => seasons.get(season.id))).toEqual(season);
  });
});
