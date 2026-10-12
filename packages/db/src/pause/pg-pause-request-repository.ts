import {
  ConcurrencyConflict,
  commitmentId,
  type Instant,
  memberId,
  PAUSE_REASONS,
  type PauseReason,
  type PauseRequestRecord,
  type PauseRequestRepository,
  type PauseResponseChoice,
  type PauseStatus,
  pauseRequestId,
  seasonId,
} from "@pactjoy/app";
import { seasonDay } from "@pactjoy/engine";
import type { SqlExecutor } from "../client.ts";

interface RequestRow {
  id: string;
  season_id: string;
  member_id: string;
  reason: string;
  note: string | null;
  requested_at: Instant;
  requested_on: number;
  start_day: number;
  last_day: number | null;
  auto_approve_at: Instant;
  status: PauseStatus;
  decided_at: Instant | null;
  decided_on: number | null;
  version: number;
}
interface CommitmentRow {
  pause_request_id: string;
  commitment_id: string;
  resumed_on: number | null;
  resumed_at: Instant | null;
}
interface ResponseRow {
  pause_request_id: string;
  member_id: string;
  response: PauseResponseChoice;
  responded_at: Instant;
}

const COLUMNS =
  "id, season_id, member_id, reason, note, requested_at, requested_on, start_day, last_day, auto_approve_at, status, decided_at, decided_on, version";

const iso = (at: Instant) => new Date(at).toISOString();
const isoOrNull = (at: Instant | null) => (at === null ? null : iso(at));

function isReason(value: string): value is PauseReason {
  return (PAUSE_REASONS as readonly string[]).includes(value);
}

/** `($1, $2), ($3, $4)`-style placeholders for `rows` rows of `width` columns, `casts[i]` appended to column i. */
function placeholders(rows: number, width: number, casts: Record<number, string> = {}): string {
  return Array.from({ length: rows }, (_, r) => {
    const cells = Array.from({ length: width }, (_, c) => `$${r * width + c + 1}${casts[c] ?? ""}`);
    return `(${cells.join(", ")})`;
  }).join(", ");
}

/**
 * The Pause request aggregate over three tables (ADR-0013). One instance per
 * transaction (see `bindRepositories`). It returns the PERSISTED state; the
 * decision a reader acts on is derived in `@pactjoy/app`.
 *
 * `save` is a version-checked UPDATE of the root with the children replaced
 * wholesale. It never sets a key column (`id`, `season_id`, `insert_seq`), so
 * the row lock is FOR NO KEY UPDATE and a concurrent writer of the same request
 * fails the version check (`ConcurrencyConflict`). An insert over an existing
 * id raises 23505 on `pause_requests_pkey`, mapped to ConcurrencyConflict by the
 * unit of work. The children are read after the roots in a separate query; the
 * root's version check makes a torn read harmless for a writer, and `read()` is
 * one snapshot.
 */
export function createPgPauseRequestRepository(exec: SqlExecutor): PauseRequestRepository {
  async function load(rows: readonly RequestRow[]): Promise<PauseRequestRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const commitments = await exec.query<CommitmentRow>(
      "select pause_request_id, commitment_id, resumed_on, resumed_at from pactjoy.pause_request_commitments where pause_request_id = any($1::uuid[]) order by pause_request_id, position",
      [ids],
    );
    const responses = await exec.query<ResponseRow>(
      "select pause_request_id, member_id, response, responded_at from pactjoy.pause_responses where pause_request_id = any($1::uuid[]) order by pause_request_id, responded_at, member_id",
      [ids],
    );
    return rows.map((row): PauseRequestRecord => {
      if (!isReason(row.reason)) throw new Error(`pause request ${row.id}: corrupt reason`);
      return {
        id: pauseRequestId(row.id),
        seasonId: seasonId(row.season_id),
        memberId: memberId(row.member_id),
        reason: row.reason,
        note: row.note,
        requestedAt: row.requested_at,
        requestedOn: seasonDay(row.requested_on),
        startDay: seasonDay(row.start_day),
        end:
          row.last_day === null
            ? { kind: "open" }
            : { kind: "fixed", lastDay: seasonDay(row.last_day) },
        autoApproveAt: row.auto_approve_at,
        status: row.status,
        decidedAt: row.decided_at,
        decidedOn: row.decided_on === null ? null : seasonDay(row.decided_on),
        commitments: commitments.rows
          .filter((c) => c.pause_request_id === row.id)
          .map((c) => ({
            commitmentId: commitmentId(c.commitment_id),
            resumedOn: c.resumed_on === null ? null : seasonDay(c.resumed_on),
            resumedAt: c.resumed_at,
          })),
        responses: responses.rows
          .filter((r) => r.pause_request_id === row.id)
          .map((r) => ({
            memberId: memberId(r.member_id),
            response: r.response,
            respondedAt: r.responded_at,
          })),
        version: row.version,
      };
    });
  }

  const select = async (where: string, params: unknown[]) =>
    load(
      (
        await exec.query<RequestRow>(
          `select ${COLUMNS} from pactjoy.pause_requests ${where}`,
          params,
        )
      ).rows,
    );

  async function replaceChildren(record: PauseRequestRecord): Promise<void> {
    await exec.query("delete from pactjoy.pause_request_commitments where pause_request_id = $1", [
      record.id,
    ]);
    await exec.query("delete from pactjoy.pause_responses where pause_request_id = $1", [
      record.id,
    ]);
    if (record.commitments.length > 0) {
      await exec.query(
        `insert into pactjoy.pause_request_commitments (pause_request_id, commitment_id, position, resumed_on, resumed_at) values ${placeholders(record.commitments.length, 5, { 4: "::timestamptz" })}`,
        record.commitments.flatMap((c, position) => [
          record.id,
          c.commitmentId,
          position,
          c.resumedOn,
          isoOrNull(c.resumedAt),
        ]),
      );
    }
    if (record.responses.length > 0) {
      await exec.query(
        `insert into pactjoy.pause_responses (pause_request_id, member_id, response, responded_at) values ${placeholders(record.responses.length, 4, { 3: "::timestamptz" })}`,
        record.responses.flatMap((r) => [record.id, r.memberId, r.response, iso(r.respondedAt)]),
      );
    }
  }

  return {
    get: async (id) => (await select("where id = $1", [id]))[0] ?? null,
    listBySeason: (season) => select("where season_id = $1 order by insert_seq", [season]),
    listDue: (now) =>
      select(
        "where status = 'pending' and auto_approve_at <= $1::timestamptz order by insert_seq",
        [iso(now)],
      ),

    async save(record, expectedVersion) {
      const values = [
        record.reason,
        record.note,
        iso(record.requestedAt),
        record.requestedOn,
        record.startDay,
        record.end.kind === "fixed" ? record.end.lastDay : null,
        iso(record.autoApproveAt),
        record.status,
        isoOrNull(record.decidedAt),
        record.decidedOn,
        record.version,
      ];
      if (expectedVersion === null) {
        await exec.query(
          "insert into pactjoy.pause_requests (id, season_id, member_id, reason, note, requested_at, requested_on, start_day, last_day, auto_approve_at, status, decided_at, decided_on, version) values ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9, $10::timestamptz, $11, $12::timestamptz, $13, $14)",
          [record.id, record.seasonId, record.memberId, ...values],
        );
      } else {
        // Only mutable columns are SET: never `id`, `season_id` or `insert_seq` (key columns, ADR-0010).
        const { rowCount } = await exec.query(
          "update pactjoy.pause_requests set reason = $2, note = $3, requested_at = $4::timestamptz, requested_on = $5, start_day = $6, last_day = $7, auto_approve_at = $8::timestamptz, status = $9, decided_at = $10::timestamptz, decided_on = $11, version = $12 where id = $1 and version = $13",
          [record.id, ...values, expectedVersion],
        );
        if (rowCount === 0) throw new ConcurrencyConflict();
      }
      await replaceChildren(record);
    },
  };
}
