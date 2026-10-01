import {
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
    replace: () => Promise.reject(new Error("EntryRepository.replace: not implemented (B6b)")),
    remove: () => Promise.reject(new Error("EntryRepository.remove: not implemented (B6b)")),
  };
}
