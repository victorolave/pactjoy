import {
  ConcurrencyConflict,
  commitmentId,
  type EntryRecord,
  type EntryRepository,
  type EntryValue,
  entryId,
  type Instant,
  memberId,
  type StoredEntry,
  seasonId,
} from "@pactjoy/app";
import { frac, seasonDay } from "@pactjoy/engine";
import type { SqlExecutor } from "../client.ts";

interface EntryRow {
  id: string;
  season_id: string;
  member_id: string;
  commitment_id: string;
  client_request_id: string;
  day: number;
  recorded_on: number;
  recorded_at: Instant;
  edited_at: Instant | null;
  version: number;
  request_fingerprint: string;
  deleted: boolean;
  value_kind: "done" | "quantity" | "missed" | null;
  value_num: bigint | null;
  value_den: bigint | null;
  note: string | null;
}

const COLUMNS =
  "id, season_id, member_id, commitment_id, client_request_id, day, recorded_on, recorded_at, edited_at, version, request_fingerprint, deleted, value_kind, value_num, value_den, note";

/** What an edit must never change: the UPDATE does not touch these, so a difference is a caller bug. */
const IMMUTABLE: Record<
  Exclude<keyof EntryRecord, "value" | "note" | "editedAt" | "version">,
  true
> = {
  id: true,
  seasonId: true,
  memberId: true,
  commitmentId: true,
  day: true,
  recordedOn: true,
  recordedAt: true,
  clientRequestId: true,
  requestFingerprint: true,
  deleted: true,
};
const IMMUTABLE_FIELDS = Object.keys(IMMUTABLE) as (keyof typeof IMMUTABLE)[];

const iso = (at: Instant) => new Date(at).toISOString();

/** The stored value; a quantity is rebuilt through `frac`, and a pair that was not already normalized is corruption. */
function decodeValue(row: EntryRow): EntryValue {
  if (row.value_kind === "quantity") {
    const { value_num: num, value_den: den } = row;
    const value = num === null || den === null ? null : frac(num, den);
    if (value === null || value.num !== num || value.den !== den) {
      throw new Error(`entry ${row.id}: corrupt quantity ${num}/${den}`);
    }
    return { kind: "quantity", value };
  }
  if (row.value_kind === "done" || row.value_kind === "missed") return { kind: row.value_kind };
  throw new Error(`entry ${row.id}: corrupt value_kind ${row.value_kind}`);
}

function toStored(row: EntryRow): StoredEntry {
  const core = {
    id: entryId(row.id),
    seasonId: seasonId(row.season_id),
    memberId: memberId(row.member_id),
    commitmentId: commitmentId(row.commitment_id),
    day: seasonDay(row.day),
    recordedOn: seasonDay(row.recorded_on),
    recordedAt: row.recorded_at,
    clientRequestId: row.client_request_id,
    editedAt: row.edited_at,
    version: row.version,
    requestFingerprint: row.request_fingerprint,
  };
  if (row.deleted) return { ...core, value: null, note: null, deleted: true };
  return { ...core, value: decodeValue(row), note: row.note, deleted: false };
}

/**
 * Entries are the source of truth. `get` and `listBySeason` never see a
 * tombstone (`not deleted`); only `getStored` and `findByClientRequest` do.
 * A duplicate id or idempotency key raises 23505 on `entries_pkey` /
 * `entries_client_request_key`, mapped to ConcurrencyConflict by the unit of
 * work. The unique key is not partial, so a tombstone keeps its key taken.
 * `replace` and `remove` are one UPDATE each, guarded by `version` and
 * `not deleted`; the affected-row count decides ConcurrencyConflict. The
 * order of `insert_seq` (and so of `listBySeason`) follows insert order, not
 * commit order: two concurrent adds may commit in either order.
 */
export function createPgEntryRepository(exec: SqlExecutor): EntryRepository {
  const stored = async (where: string, params: unknown[]) =>
    (await exec.query<EntryRow>(`select ${COLUMNS} from pactjoy.entries ${where}`, params)).rows;

  return {
    findByClientRequest: async (member, commitment, clientRequestId) => {
      const [row] = await stored(
        "where member_id = $1 and commitment_id = $2 and client_request_id = $3",
        [member, commitment, clientRequestId],
      );
      return row ? toStored(row) : null;
    },
    getStored: async (id) => {
      const [row] = await stored("where id = $1", [id]);
      return row ? toStored(row) : null;
    },
    get: async (id) => {
      const [row] = await stored("where id = $1 and not deleted", [id]);
      return row ? (toStored(row) as EntryRecord) : null;
    },
    listBySeason: async (season) =>
      (await stored("where season_id = $1 and not deleted order by insert_seq", [season])).map(
        (row) => toStored(row) as EntryRecord,
      ),

    async add(entry) {
      const quantity = entry.value.kind === "quantity" ? entry.value.value : null;
      await exec.query(
        "insert into pactjoy.entries (id, season_id, member_id, commitment_id, client_request_id, day, recorded_on, recorded_at, edited_at, version, request_fingerprint, deleted, value_kind, value_num, value_den, note) values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10, $11, false, $12, $13::int8, $14::int8, $15)",
        [
          entry.id,
          entry.seasonId,
          entry.memberId,
          entry.commitmentId,
          entry.clientRequestId,
          entry.day,
          entry.recordedOn,
          iso(entry.recordedAt),
          entry.editedAt === null ? null : iso(entry.editedAt),
          entry.version,
          entry.requestFingerprint,
          entry.value.kind,
          quantity === null ? null : quantity.num.toString(),
          quantity === null ? null : quantity.den.toString(),
          entry.note,
        ],
      );
    },

    async replace(next, expectedVersion) {
      // Needs no read, so it fails before the UPDATE: nothing is written even
      // if a caller swallows the error and commits.
      if (next.version !== expectedVersion + 1) {
        throw new Error("EntryRepository.replace: next.version must be expectedVersion + 1");
      }
      const quantity = next.value.kind === "quantity" ? next.value.value : null;
      // Writes `expected + 1`, not `next.version`, which is validated above.
      const { rows } = await exec.query<EntryRow>(
        `update pactjoy.entries set value_kind = $3, value_num = $4::int8, value_den = $5::int8, note = $6, edited_at = $7::timestamptz, version = version + 1 where id = $1 and version = $2 and not deleted returning ${COLUMNS}`,
        [
          next.id,
          expectedVersion,
          next.value.kind,
          quantity === null ? null : quantity.num.toString(),
          quantity === null ? null : quantity.den.toString(),
          next.note,
          next.editedAt === null ? null : iso(next.editedAt),
        ],
      );
      const [row] = rows;
      if (!row) throw new ConcurrencyConflict();
      const current = toStored(row);
      for (const field of IMMUTABLE_FIELDS) {
        // The transaction is rolled back by the thrown error, undoing the write.
        if (current[field] !== next[field]) {
          throw new Error(`EntryRepository.replace: immutable field "${field}" changed`);
        }
      }
    },

    async remove(id, expectedVersion) {
      const { rows } = await exec.query(
        "update pactjoy.entries set deleted = true, value_kind = null, value_num = null, value_den = null, note = null, version = version + 1 where id = $1 and version = $2 and not deleted returning id",
        [id, expectedVersion],
      );
      if (rows.length === 0) throw new ConcurrencyConflict();
    },
  };
}
