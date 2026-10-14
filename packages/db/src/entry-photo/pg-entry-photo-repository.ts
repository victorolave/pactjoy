import {
  ConcurrencyConflict,
  commitmentId,
  type EntryPhoto,
  type EntryPhotoRepository,
  type EntryPhotoStatus,
  entryPhotoId,
  type Instant,
  memberId,
  seasonId,
} from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

interface PhotoRow {
  id: string;
  season_id: string;
  member_id: string;
  commitment_id: string;
  object_key: string;
  byte_size: number;
  status: EntryPhotoStatus;
  created_at: Instant;
  attach_by: Instant;
  version: number;
}

const COLUMNS =
  "id, season_id, member_id, commitment_id, object_key, byte_size, status, created_at, attach_by, version";

/** What `save` must never change: the UPDATE does not touch these, so a difference is a caller bug. */
const IMMUTABLE: Record<Exclude<keyof EntryPhoto, "status" | "version">, true> = {
  id: true,
  seasonId: true,
  memberId: true,
  commitmentId: true,
  objectKey: true,
  byteSize: true,
  createdAt: true,
  attachBy: true,
};
const IMMUTABLE_FIELDS = Object.keys(IMMUTABLE) as (keyof typeof IMMUTABLE)[];

const iso = (at: Instant) => new Date(at).toISOString();

function toPhoto(row: PhotoRow): EntryPhoto {
  return {
    id: entryPhotoId(row.id),
    seasonId: seasonId(row.season_id),
    memberId: memberId(row.member_id),
    commitmentId: commitmentId(row.commitment_id),
    objectKey: row.object_key,
    byteSize: row.byte_size,
    status: row.status,
    createdAt: row.created_at,
    attachBy: row.attach_by,
    version: row.version,
  };
}

/**
 * The upload ledger over `pactjoy.entry_photos`. One instance per transaction (see
 * `bindRepositories`).
 *
 * A duplicate id or object key raises 23505 on `entry_photos_pkey` / `entry_photos_object_key_key`,
 * mapped to ConcurrencyConflict by the unit of work. `save` is ONE UPDATE of `status` and `version`
 * guarded by `version`; the affected-row count decides ConcurrencyConflict, which is what makes a
 * double attach lose atomically. `releaseExpired` is one UPDATE ... RETURNING over a `FOR UPDATE
 * SKIP LOCKED` selection, so concurrent sweeps release disjoint rows and never wait on each other.
 * Timestamps are compared and ordered as `timestamptz`; ties break by id.
 */
export function createPgEntryPhotoRepository(exec: SqlExecutor): EntryPhotoRepository {
  const rows = async (text: string, params: unknown[]) =>
    (await exec.query<PhotoRow>(text, params)).rows;

  return {
    async get(id) {
      const [row] = await rows(`select ${COLUMNS} from pactjoy.entry_photos where id = $1`, [id]);
      return row ? toPhoto(row) : null;
    },

    async getMany(ids) {
      if (ids.length === 0) return [];
      return (
        await rows(`select ${COLUMNS} from pactjoy.entry_photos where id = any($1::uuid[])`, [
          [...new Set(ids)],
        ])
      ).map(toPhoto);
    },

    async add(photo) {
      await exec.query(
        "insert into pactjoy.entry_photos (id, season_id, member_id, commitment_id, object_key, byte_size, status, created_at, attach_by, version) values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10)",
        [
          photo.id,
          photo.seasonId,
          photo.memberId,
          photo.commitmentId,
          photo.objectKey,
          photo.byteSize,
          photo.status,
          iso(photo.createdAt),
          iso(photo.attachBy),
          photo.version,
        ],
      );
    },

    async save(next, expectedVersion) {
      // Needs no read, so it fails before the UPDATE: nothing is written even if a caller swallows it.
      if (next.version !== expectedVersion + 1) {
        throw new Error("EntryPhotoRepository.save: next.version must be expectedVersion + 1");
      }
      // Writes `expected + 1`, not `next.version`, which is validated above. Only mutable columns are SET.
      const [row] = await rows(
        `update pactjoy.entry_photos set status = $3, version = version + 1 where id = $1 and version = $2 returning ${COLUMNS}`,
        [next.id, expectedVersion, next.status],
      );
      if (!row) throw new ConcurrencyConflict();
      const current = toPhoto(row);
      for (const field of IMMUTABLE_FIELDS) {
        // The transaction is rolled back by the thrown error, undoing the write.
        if (current[field] !== next[field]) {
          throw new Error(`EntryPhotoRepository.save: immutable field "${field}" changed`);
        }
      }
    },

    async countOpen(member, liveSince) {
      const { rows: counted } = await exec.query<{ n: number }>(
        "select count(*)::int as n from pactjoy.entry_photos where member_id = $1 and status = 'pending' and created_at > $2::timestamptz",
        [member, iso(liveSince)],
      );
      return counted[0]?.n ?? 0;
    },

    async releaseExpired(member, now, limit) {
      return (
        await rows(
          `update pactjoy.entry_photos set status = 'released', version = version + 1 where id in (select id from pactjoy.entry_photos where status = 'pending' and attach_by <= $2::timestamptz and ($1::uuid is null or member_id = $1::uuid) order by created_at, id limit $3 for update skip locked) returning ${COLUMNS}`,
          [member, iso(now), limit],
        )
      )
        .map(toPhoto)
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    },

    async listReleased(member, limit) {
      return (
        await rows(
          `select ${COLUMNS} from pactjoy.entry_photos where status = 'released' and ($1::uuid is null or member_id = $1::uuid) order by created_at, id limit $2`,
          [member, limit],
        )
      ).map(toPhoto);
    },

    async purge(ids) {
      if (ids.length === 0) return;
      await exec.query(
        "delete from pactjoy.entry_photos where id = any($1::uuid[]) and status = 'released'",
        [[...new Set(ids)]],
      );
    },
  };
}
