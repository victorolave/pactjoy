import {
  type AutomaticityResponse,
  ConcurrencyConflict,
  commitmentId,
  type Instant,
  memberId,
  type ReviewKind,
  type ReviewRecord,
  type ReviewRepository,
  type ReviewStatus,
  reviewId,
  type SrbaiItems,
  type SrbaiMode,
  type SrbaiScore,
  seasonId,
} from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

interface ReviewRow {
  id: string;
  season_id: string;
  member_id: string;
  period_index: number;
  kind: ReviewKind;
  status: ReviewStatus;
  srbai: SrbaiMode | null;
  reflection_helped: string | null;
  reflection_hard: string | null;
  recorded_at: Instant;
  version: number;
}
interface ResponseRow {
  review_id: string;
  commitment_id: string;
  item1: number;
  item2: number | null;
  item3: number | null;
  item4: number | null;
}

const COLUMNS =
  "id, season_id, member_id, period_index, kind, status, srbai, reflection_helped, reflection_hard, recorded_at, version";

const iso = (at: Instant) => new Date(at).toISOString();

// The columns hold smallint 1..7 under a CHECK, so the cast only narrows a value the database guarantees.
const score = (value: number): SrbaiScore => value as SrbaiScore;
const maybeScore = (value: number | null): SrbaiScore | null =>
  value === null ? null : score(value);

/**
 * The Review aggregate over two tables (`reviews`, `automaticity_responses`). One instance per
 * transaction (see `bindRepositories`).
 *
 * Reviews are insert-only in practice, but `save` keeps the shape of the other aggregates:
 * `expectedVersion` null inserts, otherwise a version-checked UPDATE of the mutable columns with
 * the children replaced wholesale (it never sets `id`, `season_id`, `insert_seq`). An insert that
 * hits `reviews_pkey` or `reviews_season_member_period_key` raises 23505, which the unit of work
 * maps to ConcurrencyConflict: that is the atomic guard behind "a double submit stores one".
 */
export function createPgReviewRepository(exec: SqlExecutor): ReviewRepository {
  return {
    async listMine(season, member) {
      const { rows } = await exec.query<ReviewRow>(
        `select ${COLUMNS} from pactjoy.reviews where season_id = $1 and member_id = $2 order by period_index`,
        [season, member],
      );
      if (rows.length === 0) return [];
      const answers = await exec.query<ResponseRow>(
        "select review_id, commitment_id, item1, item2, item3, item4 from pactjoy.automaticity_responses where review_id = any($1::uuid[]) order by review_id, position",
        [rows.map((r) => r.id)],
      );
      return rows.map((row): ReviewRecord => {
        const responses: AutomaticityResponse[] = answers.rows
          .filter((a) => a.review_id === row.id)
          .map((a) => {
            const items: SrbaiItems = [
              score(a.item1),
              maybeScore(a.item2),
              maybeScore(a.item3),
              maybeScore(a.item4),
            ];
            return { commitmentId: commitmentId(a.commitment_id), items };
          });
        return {
          id: reviewId(row.id),
          seasonId: seasonId(row.season_id),
          memberId: memberId(row.member_id),
          periodIndex: row.period_index,
          kind: row.kind,
          status: row.status,
          srbai: row.srbai,
          reflection: { helped: row.reflection_helped, hard: row.reflection_hard },
          responses,
          recordedAt: row.recorded_at,
          version: row.version,
        };
      });
    },

    async save(record, expectedVersion) {
      const values = [
        record.kind,
        record.status,
        record.srbai,
        record.reflection.helped,
        record.reflection.hard,
        iso(record.recordedAt),
        record.version,
      ];
      if (expectedVersion === null) {
        await exec.query(
          "insert into pactjoy.reviews (id, season_id, member_id, period_index, kind, status, srbai, reflection_helped, reflection_hard, recorded_at, version) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11)",
          [record.id, record.seasonId, record.memberId, record.periodIndex, ...values],
        );
      } else {
        // Only mutable columns are SET: never `id`, `season_id` or `insert_seq` (key columns, ADR-0010).
        const { rowCount } = await exec.query(
          "update pactjoy.reviews set kind = $2, status = $3, srbai = $4, reflection_helped = $5, reflection_hard = $6, recorded_at = $7::timestamptz, version = $8 where id = $1 and version = $9",
          [record.id, ...values, expectedVersion],
        );
        if (rowCount === 0) throw new ConcurrencyConflict();
        await exec.query("delete from pactjoy.automaticity_responses where review_id = $1", [
          record.id,
        ]);
      }
      if (record.responses.length > 0) {
        const cells = record.responses.map((_, r) => {
          const base = r * 7;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
        });
        await exec.query(
          `insert into pactjoy.automaticity_responses (review_id, commitment_id, position, item1, item2, item3, item4) values ${cells.join(", ")}`,
          record.responses.flatMap((a, position) => [
            record.id,
            a.commitmentId,
            position,
            ...a.items,
          ]),
        );
      }
    },
  };
}
