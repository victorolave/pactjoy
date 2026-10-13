import {
  ConcurrencyConflict,
  circleId,
  commitmentId,
  instant,
  localDate,
  memberId,
  ok,
  type Season,
  type SeasonClosure,
  type SeasonClosureRepository,
  seasonClosureId,
  seasonId,
  timeZoneId,
} from "@pactjoy/app";
import { describeSeasonClosureRepositoryContract } from "@pactjoy/app/contracts";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = instant(1_791_987_120_000);
const CIRCLE = {
  id: circleId(uuid(0xc1)),
  name: "C",
  members: [],
  invite: null,
  createdAt: T0,
  archivedAt: null,
  version: 0,
};
const SEASON: Season = {
  id: seasonId(uuid(0xe1)),
  circleId: CIRCLE.id,
  timeZone: timeZoneId("America/Bogota"),
  nominalStart: localDate("2026-10-01"),
  actualStart: localDate("2026-10-01"),
  lengthWeeks: 4,
  reviewCadenceWeeks: 2,
  status: "active",
  commitments: [],
  approvals: [],
  pactClosedAt: null,
  pactRevision: 0,
  createdAt: T0,
  version: 0,
};
const OWNER = memberId(uuid(0xa1));

const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
afterAll(async () => {
  await truncateAll(admin);
  await client.end();
  await admin.end();
});

const seedSeason = async () => {
  await uow.transaction(async ({ circles, seasons }) => {
    await circles.save(CIRCLE, null);
    await seasons.save(SEASON, null);
    return ok(undefined);
  });
};

/** The repository as a use case sees it: every call in its own unit of work, errors mapped. */
const repository: SeasonClosureRepository = {
  getMine: (season, member) =>
    uow.read(({ seasonClosures }) => seasonClosures.getMine(season, member)),
  closedMemberIds: (season) =>
    uow.read(({ seasonClosures }) => seasonClosures.closedMemberIds(season)),
  save: async (closure, expectedVersion) => {
    await uow.transaction(async ({ seasonClosures }) => {
      await seasonClosures.save(closure, expectedVersion);
      return ok(undefined);
    });
  },
};

describeSeasonClosureRepositoryContract("postgres", async () => {
  await truncateAll(admin);
  return { repository, seedSeason };
});

const closure = (n: number, extra: Partial<SeasonClosure> = {}): SeasonClosure => ({
  id: seasonClosureId(uuid(0x500 + n)),
  seasonId: SEASON.id,
  memberId: OWNER,
  decisions: [{ commitmentId: commitmentId(uuid(0xc01)), decision: "continue" }],
  decidedAt: T0,
  version: 0,
  ...extra,
});

beforeEach(async () => {
  await truncateAll(admin);
  await seedSeason();
});

const violates = async (run: () => PromiseLike<unknown>, constraint: string) => {
  const error = await Promise.resolve(run()).then(
    () => null,
    (e: unknown) => e as { code?: string; constraint_name?: string },
  );
  expect(error).toMatchObject({ code: expect.stringMatching(/^23/), constraint_name: constraint });
};

const insert = (extra: Record<string, unknown> = {}) => {
  const row = {
    id: uuid(0x550),
    season_id: SEASON.id,
    member_id: OWNER,
    decided_at: "2026-10-14T14:12:00Z",
    version: 0,
    ...extra,
  };
  return admin`insert into pactjoy.season_closures ${admin(row)}`;
};

describe("pactjoy.season_closures constraints", () => {
  it("SC-DB1: version has a representational CHECK", async () => {
    await violates(() => insert({ version: -1 }), "season_closures_version_check");
    await insert();
  });

  it("SC-DB2: (season, member) is unique and the season foreign key is RESTRICT", async () => {
    await insert();
    await violates(() => insert({ id: uuid(0x551) }), "season_closures_season_member_key");
    await violates(() => insert(), "season_closures_pkey");
    await insert({ id: uuid(0x552), member_id: uuid(0xa2) });
    await violates(
      () => insert({ id: uuid(0x553), season_id: uuid(0xdead), member_id: uuid(0xa3) }),
      "season_closures_season_id_fkey",
    );
    await violates(
      () => admin`delete from pactjoy.seasons where id = ${SEASON.id}`,
      "season_closures_season_id_fkey",
    );
  });

  it("SC-DB3: a decision is one of the four values, position is not negative, and children cascade", async () => {
    await insert();
    const decision = (extra: Record<string, unknown>) =>
      admin`insert into pactjoy.season_closure_decisions ${admin({
        closure_id: uuid(0x550),
        commitment_id: uuid(0xc01),
        position: 0,
        decision: "continue",
        ...extra,
      })}`;
    await decision({});
    await violates(() => decision({ position: 9 }), "season_closure_decisions_pkey");
    await violates(() => decision({ decision: "stop" }), "season_closure_decisions_decision_check");
    await violates(() => decision({ position: -1 }), "season_closure_decisions_position_check");
    await expect(Promise.resolve(decision({ decision: null }))).rejects.toMatchObject({
      code: "23502",
      column_name: "decision",
    });
    for (const [i, value] of ["continue", "adjust", "pause", "graduate"].entries()) {
      await decision({ commitment_id: uuid(0xc10 + i), position: i, decision: value });
    }
    await admin`delete from pactjoy.season_closures where id = ${uuid(0x550)}`;
    const [n] = await admin`select count(*)::int as n from pactjoy.season_closure_decisions`;
    expect(n?.n).toBe(0);
  });

  it("SC-DB4: RLS is on with no policies, client roles hold nothing, and there are no triggers", async () => {
    for (const table of ["season_closures", "season_closure_decisions"]) {
      const [rls] =
        await admin`select relrowsecurity as on from pg_class where oid = ${`pactjoy.${table}`}::regclass`;
      const [policies] =
        await admin`select count(*)::int as n from pg_policies where schemaname = 'pactjoy' and tablename = ${table}`;
      const [triggers] =
        await admin`select count(*)::int as n from pg_trigger where tgrelid = ${`pactjoy.${table}`}::regclass and not tgisinternal`;
      expect({ table, rls: rls?.on, policies: policies?.n, triggers: triggers?.n }).toEqual({
        table,
        rls: true,
        policies: 0,
        triggers: 0,
      });
      for (const role of ["anon", "authenticated"]) {
        const [priv] =
          await admin`select has_table_privilege(${role}, ${`pactjoy.${table}`}, 'select, insert, update, delete') as held`;
        expect({ table, role, held: priv?.held }).toEqual({ table, role, held: false });
      }
    }
    const [fns] =
      await admin`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pactjoy'`;
    expect(fns?.n).toBe(0);
  });
});

describe("the Postgres SeasonClosure repository", () => {
  it("SC-DB5: concurrent submits of the same member store one closure and the losers are a ConcurrencyConflict", async () => {
    const settled = await Promise.allSettled([
      repository.save(closure(1, { id: seasonClosureId(uuid(0x560)) }), null),
      repository.save(closure(1, { id: seasonClosureId(uuid(0x561)) }), null),
      repository.save(closure(1, { id: seasonClosureId(uuid(0x562)) }), null),
    ]);
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(ConcurrencyConflict);
    expect(await repository.closedMemberIds(SEASON.id)).toEqual([OWNER]);
    const [children] = await admin`select count(*)::int as n from pactjoy.season_closure_decisions`;
    expect(children?.n).toBe(1);
  });

  it("SC-DB6: a rejected duplicate leaves no orphaned decisions", async () => {
    await repository.save(closure(1), null);
    await expect(
      repository.save(
        closure(1, {
          id: seasonClosureId(uuid(0x563)),
          decisions: [{ commitmentId: commitmentId(uuid(0xc09)), decision: "graduate" }],
        }),
        null,
      ),
    ).rejects.toBeInstanceOf(ConcurrencyConflict);
    const rows = await admin`select commitment_id from pactjoy.season_closure_decisions`;
    expect(rows.map((r) => r.commitment_id)).toEqual([uuid(0xc01)]);
  });
});
