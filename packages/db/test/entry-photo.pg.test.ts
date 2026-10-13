import { readFileSync } from "node:fs";
import {
  ConcurrencyConflict,
  circleId,
  commitmentId,
  type EntryPhoto,
  type EntryPhotoRepository,
  type EntryRecord,
  entryId,
  entryPhotoId,
  instant,
  localDate,
  memberId,
  ok,
  type Season,
  seasonId,
  timeZoneId,
} from "@pactjoy/app";
import { describeEntryPhotoRepositoryContract } from "@pactjoy/app/contracts";
import { seasonDay } from "@pactjoy/engine";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";
import { MIGRATIONS_DIR } from "./migrate.ts";

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
const COMMITMENT = commitmentId(uuid(0xc01));

// Pool >= 2: the concurrency cases keep one transaction open while another runs.
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
const write = <T>(run: (repository: EntryPhotoRepository) => Promise<T>): Promise<T> =>
  uow
    .transaction(async ({ entryPhotos }) => ok(await run(entryPhotos)))
    .then((result) => (result.ok ? result.value : (undefined as T)));
const repository: EntryPhotoRepository = {
  get: (id) => uow.read(({ entryPhotos }) => entryPhotos.get(id)),
  getMany: (ids) => uow.read(({ entryPhotos }) => entryPhotos.getMany(ids)),
  add: (photo) => write((r) => r.add(photo)),
  save: (next, expected) => write((r) => r.save(next, expected)),
  countOpen: (member, now) => uow.read(({ entryPhotos }) => entryPhotos.countOpen(member, now)),
  releaseExpired: (member, now, limit) => write((r) => r.releaseExpired(member, now, limit)),
  listReleased: (member, limit) =>
    uow.read(({ entryPhotos }) => entryPhotos.listReleased(member, limit)),
  purge: (ids) => write((r) => r.purge(ids)),
};

describeEntryPhotoRepositoryContract("postgres", async () => {
  await truncateAll(admin);
  return { repository, seedSeason };
});

const KEY = (n: number) => `o/${n.toString(16).padStart(32, "0")}.jpg`;
const photo = (n: number, extra: Partial<EntryPhoto> = {}): EntryPhoto => ({
  id: entryPhotoId(uuid(0x700 + n)),
  seasonId: SEASON.id,
  memberId: OWNER,
  commitmentId: COMMITMENT,
  objectKey: KEY(n),
  byteSize: 1000 + n,
  status: "pending",
  createdAt: T0,
  attachBy: instant(T0 + 1_800_000),
  version: 0,
  ...extra,
});
const ENTRY = (n: number, extra: Partial<EntryRecord> = {}): EntryRecord => ({
  id: entryId(uuid(0x500 + n)),
  seasonId: SEASON.id,
  memberId: OWNER,
  commitmentId: COMMITMENT,
  day: seasonDay(n),
  recordedOn: seasonDay(n),
  recordedAt: instant(T0 + n),
  clientRequestId: `req-${n}`,
  editedAt: null,
  version: 0,
  requestFingerprint: `fp-${n}`,
  value: { kind: "done" },
  note: null,
  photoId: null,
  deleted: false,
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

const insertPhoto = (extra: Record<string, unknown> = {}) => {
  const row = {
    id: uuid(0x7a0),
    season_id: SEASON.id,
    member_id: OWNER,
    commitment_id: COMMITMENT,
    object_key: KEY(0xa0),
    byte_size: 1000,
    content_type: "image/jpeg",
    status: "pending",
    created_at: "2026-10-14T14:12:00Z",
    attach_by: "2026-10-14T14:42:00Z",
    version: 0,
    ...extra,
  };
  return admin`insert into pactjoy.entry_photos ${admin(row)}`;
};

describe("pactjoy.entry_photos constraints", () => {
  it("EPH-S1: size, type, status, key shape, window and version have representational CHECKs", async () => {
    await violates(() => insertPhoto({ byte_size: 0 }), "entry_photos_byte_size_check");
    await violates(
      () => insertPhoto({ byte_size: 3 * 1024 * 1024 + 1 }),
      "entry_photos_byte_size_check",
    );
    await insertPhoto({ id: uuid(0x7a1), object_key: KEY(0xa1), byte_size: 3 * 1024 * 1024 });
    await violates(
      () => insertPhoto({ content_type: "image/png" }),
      "entry_photos_content_type_check",
    );
    await violates(() => insertPhoto({ status: "uploading" }), "entry_photos_status_check");
    await violates(
      () => insertPhoto({ object_key: "o/Photo.jpg" }),
      "entry_photos_object_key_check",
    );
    await violates(
      () => insertPhoto({ object_key: `o/${"A".repeat(32)}.jpg` }),
      "entry_photos_object_key_check",
    );
    await violates(
      () => insertPhoto({ attach_by: "2026-10-14T14:12:00Z" }),
      "entry_photos_attach_by_check",
    );
    await violates(() => insertPhoto({ version: -1 }), "entry_photos_version_check");
  });

  it("EPH-S2: id and object key are unique and the season foreign key is RESTRICT", async () => {
    await insertPhoto();
    await violates(() => insertPhoto({ object_key: KEY(0xa2) }), "entry_photos_pkey");
    await violates(() => insertPhoto({ id: uuid(0x7a2) }), "entry_photos_object_key_key");
    await violates(
      () => insertPhoto({ id: uuid(0x7a3), object_key: KEY(0xa3), season_id: uuid(0xdead) }),
      "entry_photos_season_id_fkey",
    );
    await violates(
      () => admin`delete from pactjoy.seasons where id = ${SEASON.id}`,
      "entry_photos_season_id_fkey",
    );
  });

  it("EPH-S3: RLS is on with no policies, client roles hold nothing, and the migration has no triggers or functions", async () => {
    const [rls] =
      await admin`select relrowsecurity as on from pg_class where oid = 'pactjoy.entry_photos'::regclass`;
    const [policies] =
      await admin`select count(*)::int as n from pg_policies where schemaname = 'pactjoy' and tablename = 'entry_photos'`;
    const [triggers] =
      await admin`select count(*)::int as n from pg_trigger where tgrelid = 'pactjoy.entry_photos'::regclass and not tgisinternal`;
    expect({ rls: rls?.on, policies: policies?.n, triggers: triggers?.n }).toEqual({
      rls: true,
      policies: 0,
      triggers: 0,
    });
    for (const role of ["anon", "authenticated"]) {
      const [priv] =
        await admin`select has_table_privilege(${role}, 'pactjoy.entry_photos', 'select, insert, update, delete') as held`;
      expect({ role, held: priv?.held }).toEqual({ role, held: false });
    }
    const [fns] =
      await admin`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'pactjoy'`;
    expect(fns?.n).toBe(0);
    const sql = readFileSync(`${MIGRATIONS_DIR}/20261015000000_entry_photos.sql`, "utf8");
    expect(sql).not.toMatch(/\bcreate\s+(or\s+replace\s+)?(constraint\s+)?trigger\b/i);
    expect(sql).not.toMatch(/\bcreate\s+(or\s+replace\s+)?(function|procedure)\b/i);
  });
});

describe("entries.photo_id", () => {
  const withPhotos = async (...ns: number[]) => {
    for (const n of ns) await repository.add(photo(n, { status: "attached", version: 1 }));
  };
  const addEntry = (entry: EntryRecord) =>
    uow.transaction(async ({ entries }) => {
      await entries.add(entry);
      return ok(undefined);
    });

  it("EPH-S4: a photo id must exist (foreign key) and one photo belongs to one entry (unique)", async () => {
    await withPhotos(1);
    await violates(
      () =>
        admin`insert into pactjoy.entries ${admin(entryRow(ENTRY(1, { photoId: entryPhotoId(uuid(0x7ff)) })))}`,
      "entries_photo_id_fkey",
    );
    await addEntry(ENTRY(1, { photoId: entryPhotoId(uuid(0x701)) }));
    await expect(addEntry(ENTRY(2, { photoId: entryPhotoId(uuid(0x701)) }))).rejects.toBeInstanceOf(
      ConcurrencyConflict,
    );
    // Many entries without a photo are fine: null is not a duplicate.
    await addEntry(ENTRY(3));
    await addEntry(ENTRY(4));
  });

  it("EPH-S5: a referenced photo row cannot be deleted (RESTRICT), so a purge never orphans an entry", async () => {
    await withPhotos(1);
    await addEntry(ENTRY(1, { photoId: entryPhotoId(uuid(0x701)) }));
    await violates(
      () => admin`delete from pactjoy.entry_photos where id = ${uuid(0x701)}`,
      "entries_photo_id_fkey",
    );
  });

  it("EPH-S6: a tombstone cannot keep a photo id", async () => {
    await withPhotos(1);
    await violates(
      () =>
        admin`insert into pactjoy.entries ${admin({
          ...entryRow(ENTRY(1, { photoId: entryPhotoId(uuid(0x701)) })),
          deleted: true,
          value_kind: null,
          note: null,
        })}`,
      "entries_photo_shape",
    );
  });

  it("EPH-S7: remove blanks the photo id, then the released photo can be purged", async () => {
    await withPhotos(1);
    const entry = ENTRY(1, { photoId: entryPhotoId(uuid(0x701)) });
    await addEntry(entry);
    await uow.transaction(async ({ entries, entryPhotos }) => {
      await entries.remove(entry.id, 0);
      await entryPhotos.save(photo(1, { status: "released", version: 2 }), 1);
      return ok(undefined);
    });
    await repository.purge([entryPhotoId(uuid(0x701))]);
    expect(await repository.get(entryPhotoId(uuid(0x701)))).toBeNull();
    expect(await uow.read(({ entries }) => entries.getStored(entry.id))).toMatchObject({
      deleted: true,
      photoId: null,
    });
  });

  it("EPH-S8: replace swaps the photo id in the same UPDATE as the value", async () => {
    await withPhotos(1, 2);
    const entry = ENTRY(1, { photoId: entryPhotoId(uuid(0x701)) });
    await addEntry(entry);
    await uow.transaction(async ({ entries }) => {
      await entries.replace({ ...entry, photoId: entryPhotoId(uuid(0x702)), version: 1 }, 0);
      return ok(undefined);
    });
    expect(await uow.read(({ entries }) => entries.get(entry.id))).toMatchObject({
      photoId: uuid(0x702),
      version: 1,
    });
  });
});

describe("the Postgres EntryPhoto repository", () => {
  it("EPH-S9: two concurrent attaches of one photo: one wins, the other is a ConcurrencyConflict", async () => {
    await repository.add(photo(1));
    const attach = () =>
      uow.transaction(async ({ entryPhotos }) => {
        await entryPhotos.save(photo(1, { status: "attached", version: 1 }), 0);
        return ok(undefined);
      });
    const settled = await Promise.allSettled([attach(), attach()]);
    expect(settled.map((s) => s.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = settled.find((s) => s.status === "rejected");
    expect(lost?.status === "rejected" && lost.reason).toBeInstanceOf(ConcurrencyConflict);
    expect(await repository.get(entryPhotoId(uuid(0x701)))).toMatchObject({
      status: "attached",
      version: 1,
    });
  });

  it("EPH-S10: concurrent sweeps release disjoint rows", async () => {
    for (let n = 1; n <= 6; n++) await repository.add(photo(n, { attachBy: instant(T0 + n) }));
    const now = instant(T0 + 1_000);
    const [a, b] = await Promise.all([
      repository.releaseExpired(null, now, 4),
      repository.releaseExpired(null, now, 4),
    ]);
    const ids = [...a, ...b].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
  });

  it("EPH-S11: save sets only status and version", async () => {
    await repository.add(photo(1));
    const statements: string[] = [];
    const spied = createUnitOfWork(client.begin, (exec, mode) =>
      bindRepositories(
        {
          query: (text, params) => {
            statements.push(text);
            return exec.query(text, params);
          },
        },
        mode,
      ),
    );
    await spied.transaction(async ({ entryPhotos }) => {
      await entryPhotos.save(photo(1, { status: "attached", version: 1 }), 0);
      return ok(undefined);
    });
    const update = statements.find((s) => /^\s*update/i.test(s)) ?? "";
    const set = [...(update.match(/set (.*?) where/is)?.[1] ?? "").matchAll(/(\w+) =/g)].map(
      (m) => m[1],
    );
    expect(set).toEqual(["status", "version"]);
  });
});

function entryRow(entry: EntryRecord) {
  return {
    id: entry.id,
    season_id: entry.seasonId,
    member_id: entry.memberId,
    commitment_id: entry.commitmentId,
    client_request_id: entry.clientRequestId,
    day: entry.day,
    recorded_on: entry.recordedOn,
    recorded_at: new Date(entry.recordedAt).toISOString(),
    version: entry.version,
    request_fingerprint: entry.requestFingerprint,
    deleted: false,
    value_kind: "done",
    photo_id: entry.photoId,
  };
}
