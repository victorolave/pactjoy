import {
  ConcurrencyConflict,
  circleId,
  commitmentId,
  instant,
  localDate,
  memberId,
  ok,
  type ReviewRecord,
  type ReviewRepository,
  reviewId,
  type Season,
  seasonId,
  timeZoneId,
} from "@pactjoy/app";
import { describeReviewRepositoryContract } from "@pactjoy/app/contracts";
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
  lengthWeeks: 8,
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
const repository: ReviewRepository = {
  deleteByMembers: async (members) => {
    await uow.transaction(async ({ reviews }) => {
      await reviews.deleteByMembers(members);
      return ok(undefined);
    });
  },
  deleteBySeasons: async (seasons) => {
    await uow.transaction(async ({ reviews }) => {
      await reviews.deleteBySeasons(seasons);
      return ok(undefined);
    });
  },
  listMine: (season, member) => uow.read(({ reviews }) => reviews.listMine(season, member)),
  save: async (record, expectedVersion) => {
    await uow.transaction(async ({ reviews }) => {
      await reviews.save(record, expectedVersion);
      return ok(undefined);
    });
  },
};

describeReviewRepositoryContract("postgres", async () => {
  await truncateAll(admin);
  return { repository, seedSeason };
});

const record = (n: number, extra: Partial<ReviewRecord> = {}): ReviewRecord =>
  ({
    id: reviewId(uuid(0xf00 + n)),
    seasonId: SEASON.id,
    memberId: OWNER,
    periodIndex: n,
    kind: "interim",
    status: "completed",
    srbai: "item1",
    reflection: { helped: null, hard: null },
    responses: [{ commitmentId: commitmentId(uuid(0xc01)), items: [4, null, null, null] }],
    recordedAt: T0,
    version: 0,
    ...extra,
  }) satisfies ReviewRecord;

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
    id: uuid(0xf50),
    season_id: SEASON.id,
    member_id: OWNER,
    period_index: 1,
    kind: "interim",
    status: "completed",
    srbai: "item1",
    recorded_at: "2026-10-14T14:12:00Z",
    version: 0,
    ...extra,
  };
  return admin`insert into pactjoy.reviews ${admin(row)}`;
};

describe("pactjoy.reviews constraints", () => {
  it("RV-S1: kind, status, srbai, period and version have representational CHECKs", async () => {
    await violates(() => insert({ kind: "weekly" }), "reviews_kind_check");
    await violates(() => insert({ status: "pending" }), "reviews_status_check");
    await violates(() => insert({ srbai: "half" }), "reviews_srbai_check");
    await violates(() => insert({ period_index: -1 }), "reviews_period_index_check");
    await violates(() => insert({ version: -1 }), "reviews_version_check");
  });

  it("RV-S2: reviews_kind_shape ties the baseline kind to period 0", async () => {
    await violates(() => insert({ kind: "baseline", period_index: 1 }), "reviews_kind_shape");
    await violates(() => insert({ kind: "interim", period_index: 0 }), "reviews_kind_shape");
    await insert({ kind: "baseline", period_index: 0, srbai: "full" });
    await insert({ id: uuid(0xf51), kind: "closing", period_index: 4 });
  });

  it("RV-S3: reviews_status_shape ties a completed review to its SRBAI mode, and a skip to no answers", async () => {
    await violates(() => insert({ status: "completed", srbai: null }), "reviews_status_shape");
    await violates(() => insert({ status: "skipped", srbai: "full" }), "reviews_status_shape");
    await violates(
      () =>
        insert({
          kind: "baseline",
          period_index: 0,
          status: "skipped",
          srbai: null,
          reflection_helped: "x",
        }),
      "reviews_status_shape",
    );
    await insert({ kind: "baseline", period_index: 0, status: "skipped", srbai: null });
  });

  it("RV-S4: (season, member, period) is unique and the season foreign key is RESTRICT", async () => {
    await insert();
    await violates(() => insert({ id: uuid(0xf52) }), "reviews_season_member_period_key");
    await violates(() => insert(), "reviews_pkey");
    await insert({ id: uuid(0xf53), member_id: uuid(0xa2) });
    await violates(
      () => insert({ id: uuid(0xf54), season_id: uuid(0xdead), period_index: 2 }),
      "reviews_season_id_fkey",
    );
    await violates(
      () => admin`delete from pactjoy.seasons where id = ${SEASON.id}`,
      "reviews_season_id_fkey",
    );
  });

  it("RV-S5: answers are 1..7, item 1 is required, and the children cascade with the review", async () => {
    await insert();
    const answer = (extra: Record<string, unknown>) =>
      admin`insert into pactjoy.automaticity_responses ${admin({
        review_id: uuid(0xf50),
        commitment_id: uuid(0xc01),
        position: 0,
        item1: 4,
        ...extra,
      })}`;
    await violates(() => answer({ item1: 0 }), "automaticity_responses_item1_check");
    await violates(() => answer({ item1: 8 }), "automaticity_responses_item1_check");
    await violates(() => answer({ item2: 8 }), "automaticity_responses_item2_check");
    await violates(() => answer({ item3: 0 }), "automaticity_responses_item3_check");
    await violates(() => answer({ item4: 9 }), "automaticity_responses_item4_check");
    await expect(Promise.resolve(answer({ item1: null }))).rejects.toMatchObject({
      code: "23502",
      column_name: "item1",
    });
    await answer({});
    await violates(() => answer({ position: 1 }), "automaticity_responses_pkey");
    await admin`delete from pactjoy.reviews where id = ${uuid(0xf50)}`;
    const [n] = await admin`select count(*)::int as n from pactjoy.automaticity_responses`;
    expect(n?.n).toBe(0);
  });

  it("RV-S6: RLS is on with no policies, client roles hold nothing, and there are no triggers or functions", async () => {
    for (const table of ["reviews", "automaticity_responses"]) {
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

describe("the Postgres Review repository", () => {
  it("RV-S7: concurrent submits of the same period store one review and the loser is a ConcurrencyConflict", async () => {
    const settled = await Promise.allSettled([
      repository.save(record(1, { id: reviewId(uuid(0xf60)) }), null),
      repository.save(record(1, { id: reviewId(uuid(0xf61)) }), null),
      repository.save(record(1, { id: reviewId(uuid(0xf62)) }), null),
    ]);
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(ConcurrencyConflict);
    expect(await repository.listMine(SEASON.id, OWNER)).toHaveLength(1);
    const [children] = await admin`select count(*)::int as n from pactjoy.automaticity_responses`;
    expect(children?.n).toBe(1);
  });

  it("RV-S8: a rejected duplicate leaves no orphaned answers", async () => {
    await repository.save(record(1), null);
    await expect(
      repository.save(
        record(1, {
          id: reviewId(uuid(0xf63)),
          responses: [{ commitmentId: commitmentId(uuid(0xc09)), items: [7, null, null, null] }],
        }),
        null,
      ),
    ).rejects.toBeInstanceOf(ConcurrencyConflict);
    const rows = await admin`select commitment_id from pactjoy.automaticity_responses`;
    expect(rows.map((r) => r.commitment_id)).toEqual([uuid(0xc01)]);
  });
});
