import {
  type ClosureDecision,
  ConcurrencyConflict,
  commitmentId,
  type Instant,
  memberId,
  type SeasonClosure,
  type SeasonClosureRepository,
  seasonClosureId,
  seasonId,
} from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

interface ClosureRow {
  id: string;
  season_id: string;
  member_id: string;
  decided_at: Instant;
  version: number;
}
interface DecisionRow {
  commitment_id: string;
  decision: ClosureDecision;
}

const COLUMNS = "id, season_id, member_id, decided_at, version";

const iso = (at: Instant) => new Date(at).toISOString();

/**
 * The SeasonClosure aggregate over two tables (`season_closures`, `season_closure_decisions`). One
 * instance per transaction (see `bindRepositories`).
 *
 * Closures are insert-only in practice, but `save` keeps the shape of the other aggregates:
 * `expectedVersion` null inserts, otherwise a version-checked UPDATE of the mutable columns with
 * the children replaced wholesale (it never sets `id`, `season_id` or `insert_seq`). An insert that
 * hits `season_closures_pkey` or `season_closures_season_member_key` raises 23505, which the unit
 * of work maps to ConcurrencyConflict: that is the atomic guard behind "a double submit stores one".
 */
export function createPgSeasonClosureRepository(exec: SqlExecutor): SeasonClosureRepository {
  return {
    async getMine(season, member) {
      const { rows } = await exec.query<ClosureRow>(
        `select ${COLUMNS} from pactjoy.season_closures where season_id = $1 and member_id = $2`,
        [season, member],
      );
      const row = rows[0];
      if (!row) return null;
      const children = await exec.query<DecisionRow>(
        "select commitment_id, decision from pactjoy.season_closure_decisions where closure_id = $1 order by position",
        [row.id],
      );
      return {
        id: seasonClosureId(row.id),
        seasonId: seasonId(row.season_id),
        memberId: memberId(row.member_id),
        decisions: children.rows.map((d) => ({
          commitmentId: commitmentId(d.commitment_id),
          decision: d.decision,
        })),
        decidedAt: row.decided_at,
        version: row.version,
      } satisfies SeasonClosure;
    },

    // Ids only: this is the one season-wide read, and it never touches the decisions table.
    async closedMemberIds(season) {
      const { rows } = await exec.query<{ member_id: string }>(
        "select member_id from pactjoy.season_closures where season_id = $1 order by insert_seq",
        [season],
      );
      return rows.map((r) => memberId(r.member_id));
    },

    async save(closure, expectedVersion) {
      const values = [iso(closure.decidedAt), closure.version];
      if (expectedVersion === null) {
        await exec.query(
          "insert into pactjoy.season_closures (id, season_id, member_id, decided_at, version) values ($1, $2, $3, $4::timestamptz, $5)",
          [closure.id, closure.seasonId, closure.memberId, ...values],
        );
      } else {
        // Only mutable columns are SET: never `id`, `season_id` or `insert_seq` (key columns, ADR-0010).
        const { rowCount } = await exec.query(
          "update pactjoy.season_closures set decided_at = $2::timestamptz, version = $3 where id = $1 and version = $4",
          [closure.id, ...values, expectedVersion],
        );
        if (rowCount === 0) throw new ConcurrencyConflict();
        await exec.query("delete from pactjoy.season_closure_decisions where closure_id = $1", [
          closure.id,
        ]);
      }
      if (closure.decisions.length > 0) {
        const cells = closure.decisions.map((_, r) => {
          const base = r * 4;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        });
        await exec.query(
          `insert into pactjoy.season_closure_decisions (closure_id, commitment_id, position, decision) values ${cells.join(", ")}`,
          closure.decisions.flatMap((d, position) => [
            closure.id,
            d.commitmentId,
            position,
            d.decision,
          ]),
        );
      }
    },
  };
}
