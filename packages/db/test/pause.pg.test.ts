import {
  circleId,
  commitmentId,
  instant,
  localDate,
  memberId,
  ok,
  type PauseRequestRecord,
  pauseRequestId,
  type Season,
  seasonId,
  timeZoneId,
} from "@pactjoy/app";
import { seasonDay } from "@pactjoy/engine";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SqlExecutor } from "../src/client.ts";
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
const REQUEST: PauseRequestRecord = {
  id: pauseRequestId(uuid(0xb01)),
  seasonId: SEASON.id,
  memberId: memberId(uuid(0xa1)),
  reason: "health",
  note: null,
  requestedAt: T0,
  requestedOn: seasonDay(5),
  startDay: seasonDay(5),
  end: { kind: "open" },
  autoApproveAt: instant(T0 + 48 * 3_600_000),
  status: "pending",
  decidedAt: null,
  decidedOn: null,
  commitments: [{ commitmentId: commitmentId(uuid(0xc01)), resumedOn: null, resumedAt: null }],
  responses: [],
  version: 0,
};

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
  await truncateAll(admin);
  await client.end();
  await admin.end();
});
beforeEach(async () => {
  await truncateAll(admin);
  await uow.transaction(async ({ circles, seasons }) => {
    await circles.save(CIRCLE, null);
    await seasons.save(SEASON, null);
    return ok(undefined);
  });
  statements.length = 0;
});

const insert = (extra: Record<string, unknown> = {}) => {
  const row = {
    id: uuid(0xb02),
    season_id: SEASON.id,
    member_id: uuid(0xa1),
    reason: "health",
    requested_at: "2026-10-14T14:12:00Z",
    requested_on: 5,
    start_day: 5,
    auto_approve_at: "2026-10-16T14:12:00Z",
    status: "pending",
    version: 0,
    ...extra,
  };
  return admin`insert into pactjoy.pause_requests ${admin(row)}`;
};

const violates = async (run: () => PromiseLike<unknown>, constraint: string) => {
  const error = await Promise.resolve(run()).then(
    () => null,
    (e: unknown) => e as { code?: string; constraint_name?: string },
  );
  expect(error).toMatchObject({ code: expect.stringMatching(/^23/), constraint_name: constraint });
};

describe("pactjoy.pause_requests constraints (ADR-0013)", () => {
  it("PP-S1: reason, status and version have representational CHECKs", async () => {
    await violates(() => insert({ reason: "vacation" }), "pause_requests_reason_check");
    await violates(
      () => insert({ status: "denied", decided_at: "2026-10-15T10:00:00Z", decided_on: 6 }),
      "pause_requests_status_check",
    );
    await violates(() => insert({ version: -1 }), "pause_requests_version_check");
    await violates(() => insert({ start_day: -1 }), "pause_requests_start_day_check");
    await violates(() => insert({ last_day: -1 }), "pause_requests_last_day_check");
  });

  it("PP-S2: pause_requests_decision_shape ties status to the decision columns", async () => {
    await violates(
      () => insert({ status: "pending", decided_at: "2026-10-15T10:00:00Z", decided_on: 6 }),
      "pause_requests_decision_shape",
    );
    await violates(() => insert({ status: "approved" }), "pause_requests_decision_shape");
    await violates(
      () => insert({ status: "rejected", decided_at: "2026-10-15T10:00:00Z" }),
      "pause_requests_decision_shape",
    );
    await insert({ status: "cancelled", decided_at: "2026-10-15T10:00:00Z", decided_on: 6 });
    await insert({ id: uuid(0xb03) });
  });

  it("PP-S3: the season foreign key is RESTRICT and an unknown season is refused", async () => {
    await violates(() => insert({ season_id: uuid(0xdead) }), "pause_requests_season_id_fkey");
    await insert();
    await violates(
      () => admin`delete from pactjoy.seasons where id = ${SEASON.id}`,
      "pause_requests_season_id_fkey",
    );
  });

  it("PP-S4: children cascade with the request, and have their own CHECKs and keys", async () => {
    await insert();
    await violates(
      () =>
        admin`insert into pactjoy.pause_request_commitments (pause_request_id, commitment_id, position, resumed_on) values (${uuid(0xb02)}, ${uuid(0xc01)}, 0, 7)`,
      "pause_request_commitments_resume_shape",
    );
    await admin`insert into pactjoy.pause_request_commitments (pause_request_id, commitment_id, position) values (${uuid(0xb02)}, ${uuid(0xc01)}, 0)`;
    await violates(
      () =>
        admin`insert into pactjoy.pause_request_commitments (pause_request_id, commitment_id, position) values (${uuid(0xb02)}, ${uuid(0xc01)}, 1)`,
      "pause_request_commitments_pkey",
    );
    await violates(
      () =>
        admin`insert into pactjoy.pause_responses (pause_request_id, member_id, response, responded_at) values (${uuid(0xb02)}, ${uuid(0xa2)}, 'maybe', now())`,
      "pause_responses_response_check",
    );
    await admin`insert into pactjoy.pause_responses (pause_request_id, member_id, response, responded_at) values (${uuid(0xb02)}, ${uuid(0xa2)}, 'approve', now())`;
    await violates(
      () =>
        admin`insert into pactjoy.pause_responses (pause_request_id, member_id, response, responded_at) values (${uuid(0xb02)}, ${uuid(0xa2)}, 'reject', now())`,
      "pause_responses_pkey",
    );

    await admin`delete from pactjoy.pause_requests where id = ${uuid(0xb02)}`;
    const [c] = await admin`select count(*)::int as n from pactjoy.pause_request_commitments`;
    const [r] = await admin`select count(*)::int as n from pactjoy.pause_responses`;
    expect([c?.n, r?.n]).toEqual([0, 0]);
  });

  it("PP-S5: the due index is partial on pending, and the season index follows creation order", async () => {
    const indexes =
      await admin`select indexname, indexdef from pg_indexes where schemaname = 'pactjoy' and tablename = 'pause_requests'`;
    const def = (name: string) => indexes.find((i) => i.indexname === name)?.indexdef as string;
    expect(def("pause_requests_due_idx")).toMatch(/\(auto_approve_at\).*WHERE.*status.*pending/s);
    expect(def("pause_requests_season_idx")).toMatch(/\(season_id, insert_seq\)/);
  });

  it("PP-S6: RLS is on with no policies, client roles hold nothing, and there are no triggers or functions", async () => {
    const tables = ["pause_requests", "pause_request_commitments", "pause_responses"];
    for (const table of tables) {
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

describe("the Postgres Pause request repository", () => {
  it("PP-S7: a save is one UPDATE that sets only the mutable columns, never a key column", async () => {
    await uow.transaction(async ({ pauses }) => {
      await pauses.save(REQUEST, null);
      return ok(undefined);
    });
    statements.length = 0;

    await uow.transaction(async ({ pauses }) => {
      await pauses.save(
        {
          ...REQUEST,
          status: "approved",
          decidedAt: instant(T0 + 1000),
          decidedOn: seasonDay(5),
          version: 1,
        },
        0,
      );
      return ok(undefined);
    });

    const updates = statements.filter((s) => /^\s*update/i.test(s));
    expect(updates).toHaveLength(1);
    const set = [...(updates[0]?.match(/set (.*?) where/is)?.[1] ?? "").matchAll(/(\w+) =/g)].map(
      (m) => m[1],
    );
    expect(set).not.toContain("id");
    expect(set).not.toContain("season_id");
    expect(set).not.toContain("insert_seq");
    expect(set).toContain("version");
  });

  it("PP-S8: listBySeason follows creation order and listDue only returns pending requests past their deadline", async () => {
    const second = { ...REQUEST, id: pauseRequestId(uuid(0xb04)), requestedAt: instant(T0 - 1) };
    const decided: PauseRequestRecord = {
      ...REQUEST,
      id: pauseRequestId(uuid(0xb05)),
      status: "rejected",
      decidedAt: T0,
      decidedOn: seasonDay(5),
      version: 1,
    };
    await uow.transaction(async ({ pauses }) => {
      await pauses.save(REQUEST, null);
      await pauses.save(second, null);
      await pauses.save(decided, null);
      return ok(undefined);
    });

    const all = await uow.read(({ pauses }) => pauses.listBySeason(SEASON.id));
    const due = await uow.read(({ pauses }) => pauses.listDue(instant(REQUEST.autoApproveAt)));
    const early = await uow.read(({ pauses }) =>
      pauses.listDue(instant(REQUEST.autoApproveAt - 1)),
    );

    expect(all.map((r) => r.id)).toEqual([REQUEST.id, second.id, decided.id]);
    expect(due.map((r) => r.id)).toEqual([REQUEST.id, second.id]);
    expect(early).toEqual([]);
  });
});
