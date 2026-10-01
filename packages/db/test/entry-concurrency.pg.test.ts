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
import { seasonDay } from "@pactjoy/engine";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SqlExecutor } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = instant(1_700_000_000_000);
const CIRCLE = {
  id: circleId(uuid(0xc1)),
  name: "C",
  members: [],
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
const E: EntryRecord = {
  id: entryId(uuid(0x501)),
  seasonId: S.id,
  memberId: memberId(uuid(0xa1)),
  commitmentId: commitmentId(uuid(0x301)),
  day: seasonDay(1),
  recordedOn: seasonDay(1),
  recordedAt: instant(T0 + 1),
  clientRequestId: "req-1",
  editedAt: null,
  version: 0,
  requestFingerprint: "fp-1",
  value: { kind: "done" },
  note: null,
  deleted: false,
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
  await uow.transaction(async ({ circles, seasons, entries }) => {
    await circles.save(CIRCLE, null);
    await seasons.save(S, null);
    await entries.add(E);
    return ok(undefined);
  });
  statements.length = 0;
});

const replaceE = (note: string) =>
  uow.transaction(async ({ entries }) => {
    await entries.replace({ ...E, note, version: 1 }, 0);
    return ok(undefined);
  });
const removeE = (expected = 0) =>
  uow.transaction(async ({ entries }) => {
    await entries.remove(E.id, expected);
    return ok(undefined);
  });
const stored = () => uow.read(({ entries }) => entries.getStored(E.id));

describe("entry writes on Postgres", () => {
  it("EP-S19: each write is one UPDATE that sets only the mutable columns", async () => {
    await replaceE("n");
    await removeE(1);
    const updates = statements.filter((s) => /^\s*update/i.test(s));
    expect(updates).toHaveLength(2);
    const set = (sql: string) =>
      [...(sql.match(/set (.*?) where/is)?.[1] ?? "").matchAll(/(\w+) =/g)].map((m) => m[1]);
    expect(set(updates[0] as string)).toEqual([
      "value_kind",
      "value_num",
      "value_den",
      "note",
      "edited_at",
      "version",
    ]);
    expect(set(updates[1] as string)).toEqual([
      "deleted",
      "value_kind",
      "value_num",
      "value_den",
      "note",
      "version",
    ]);
    expect(updates.every((u) => /where id = \$1 and version = \$2 and not deleted/i.test(u))).toBe(
      true,
    );
  });

  it("EP-S20: two concurrent replaces at the same version, one wins and one conflicts", async () => {
    const settled = await Promise.allSettled([replaceE("a"), replaceE("b")]);
    expect(settled.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = settled.find((r) => r.status === "rejected");
    expect(lost?.status === "rejected" && lost.reason).toBeInstanceOf(ConcurrencyConflict);
    expect(await stored()).toMatchObject({ version: 1, deleted: false });
  });

  it("EP-S24: a concurrent remove and replace at the same version, exactly one wins", async () => {
    const settled = await Promise.allSettled([removeE(), replaceE("a")]);
    expect(settled.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = settled.find((r) => r.status === "rejected");
    expect(lost?.status === "rejected" && lost.reason).toBeInstanceOf(ConcurrencyConflict);
    expect(await stored()).toMatchObject({
      version: 1,
      deleted: settled[0]?.status === "fulfilled",
    });
  });

  it("a season save does not deadlock against an uncommitted entry insert holding KEY SHARE", async () => {
    let open!: () => void;
    let held!: () => void;
    const release = new Promise<void>((r) => {
      open = r;
    });
    const ready = new Promise<void>((r) => {
      held = r;
    });
    const inserting = uow.transaction(async ({ entries }) => {
      await entries.add({
        ...E,
        id: entryId(uuid(0x502)),
        clientRequestId: "req-2",
        requestFingerprint: "fp-2",
      });
      held();
      await release;
      return ok(undefined);
    });
    inserting.catch(() => undefined);
    try {
      await Promise.race([ready, inserting]);
      const save = uow.transaction(async ({ seasons }) => {
        await seasons.guardVersion(S.id, 0);
        await seasons.save({ ...S, version: 1 }, 0);
        return ok(undefined);
      });
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("season save blocked behind the entry insert")), 3000);
      });
      await Promise.race([save, timeout]);
    } finally {
      open();
      await Promise.allSettled([inserting]);
    }
    await inserting;
    expect(await uow.read(({ seasons }) => seasons.get(S.id))).toMatchObject({ version: 1 });
    expect(await uow.read(({ entries }) => entries.listBySeason(S.id))).toHaveLength(2);
  });
});
