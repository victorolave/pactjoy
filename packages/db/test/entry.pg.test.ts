import {
  ConcurrencyConflict,
  circleId,
  commitmentId,
  type EntryRecord,
  entryId,
  instant,
  localDate,
  memberId,
  ok,
  type Season,
  seasonId,
  timeZoneId,
} from "@pactjoy/app";
import { frac, seasonDay } from "@pactjoy/engine";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = instant(1_700_000_000_000);
const season: Season = {
  id: seasonId(uuid(0xe1)),
  circleId: circleId(uuid(0xc1)),
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
const entry = (n: number, options: Partial<EntryRecord> = {}): EntryRecord => ({
  id: entryId(uuid(0x500 + n)),
  seasonId: season.id,
  memberId: memberId(uuid(0xa1)),
  commitmentId: commitmentId(uuid(0x301)),
  day: seasonDay(n),
  recordedOn: seasonDay(n),
  recordedAt: instant(T0 + n),
  clientRequestId: `req-${n}`,
  editedAt: null,
  version: 0,
  requestFingerprint: `fp-${n}`,
  value: { kind: "done" },
  note: null,
  deleted: false,
  ...options,
});

const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
const tzUow = createUnitOfWork(
  (isolation, work) =>
    client.begin(isolation, async (tx) => {
      await tx.query("set local timezone = 'Pacific/Kiritimati'", []);
      return work(tx);
    }),
  bindRepositories,
);
const add = (e: EntryRecord, u = uow) =>
  u.transaction(async ({ entries }) => {
    await entries.add(e);
    return ok(undefined);
  });
afterAll(async () => {
  await client.end();
  await admin.end();
});
beforeEach(async () => {
  await uow.transaction(async ({ circles, seasons }) => {
    await circles.save(
      {
        id: season.circleId,
        name: "C",
        members: [],
        invite: null,
        createdAt: T0,
        archivedAt: null,
        version: 0,
      },
      null,
    );
    await seasons.save(season, null);
    return ok(undefined);
  });
});

describe("entry repository on Postgres (add/read side)", () => {
  it("EP-S7: the idempotency key is a plain unique constraint and a concurrent duplicate add loses", async () => {
    const [{ def }] = (await admin.unsafe(
      "select pg_get_indexdef(indexrelid) as def from pg_index where indexrelid = 'pactjoy.entries_client_request_key'::regclass",
    )) as unknown as [{ def: string }];
    expect(def).not.toMatch(/where/i);
    const results = await Promise.allSettled([
      add(entry(1, { clientRequestId: "same" })),
      add(entry(2, { clientRequestId: "same" })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = results.find((r) => r.status === "rejected");
    expect(lost).toMatchObject({ reason: expect.any(ConcurrencyConflict) });
  });

  it("EP-S28: the shape CHECK rejects a half fraction, a quantity without one and a tombstone with a value", async () => {
    const bad = (cols: string, vals: string) =>
      admin
        .unsafe(
          `insert into pactjoy.entries (id, season_id, member_id, commitment_id, client_request_id, day, recorded_on, recorded_at, version, request_fingerprint, deleted, ${cols}) values ('${uuid(0x9)}', '${season.id}', '${uuid(0xa1)}', '${uuid(0x301)}', 'x', 0, 0, now(), 0, 'f', ${vals})`,
        )
        .catch((e) => e);
    expect(await bad("value_kind, value_num", "false, 'quantity', 1")).toMatchObject({
      constraint_name: "entries_value_shape",
    });
    expect(await bad("value_kind", "false, 'quantity'")).toMatchObject({
      constraint_name: "entries_value_shape",
    });
    expect(await bad("value_kind", "true, 'done'")).toMatchObject({
      constraint_name: "entries_value_shape",
    });
    expect(await bad("value_kind, value_num, value_den", "false, 'quantity', 1, 0")).toMatchObject({
      constraint_name: "entries_value_den_check",
    });
  });

  it("EP-S29: a fraction beyond int64 is a raw database error", async () => {
    const huge = entry(1, { value: { kind: "quantity", value: frac(2n ** 63n, 1n) } });
    await expect(add(huge)).rejects.toMatchObject({ code: "22003" });
  });

  it("EP-S32: instants survive a non-UTC session time zone", async () => {
    const e = entry(1, { editedAt: instant(T0 + 5) });
    await add(e, tzUow);
    expect(await tzUow.read(({ entries }) => entries.get(e.id))).toEqual(e);
    expect(await uow.read(({ entries }) => entries.get(e.id))).toEqual(e);
  });

  it("EP-S34/SP-S16: a season with entries cannot be deleted (RESTRICT) and nothing is lost", async () => {
    await add(entry(1));
    const error = await uow
      .transaction(async ({ seasons }) => {
        await seasons.delete(season.id, 0);
        return ok(undefined);
      })
      .catch((e) => e);
    expect(error).toMatchObject({ code: "23503", constraint_name: "entries_season_id_fkey" });
    expect(await uow.read(({ entries }) => entries.listBySeason(season.id))).toHaveLength(1);
  });
});
