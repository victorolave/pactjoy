import {
  type CommitmentRecord,
  ConcurrencyConflict,
  circleId,
  commitmentId,
  habitId,
  type Instant,
  isReviewCadenceWeeks,
  isSeasonLengthWeeks,
  type LocalDate,
  localDate,
  memberId,
  type PactApproval,
  type Season,
  type SeasonRepository,
  type SeasonStatus,
  seasonId,
  timeZoneId,
} from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";
import { decodeMeasure, encodeMeasure } from "./measure-codec.ts";

interface SeasonRow {
  id: string;
  circle_id: string;
  time_zone: string;
  nominal_start: LocalDate;
  actual_start: LocalDate | null;
  length_weeks: number;
  review_cadence_weeks: number;
  status: SeasonStatus;
  pact_closed_at: Instant | null;
  created_at: Instant;
  version: number;
}
interface CommitmentRow {
  id: string;
  member_id: string;
  habit_id: string;
  weight_percent: number;
  privacy: "visible" | "private";
  measure: unknown;
}
interface ApprovalRow {
  member_id: string;
  approved_at: Instant;
}

const iso = (at: Instant) => new Date(at).toISOString();
const isoOrNull = (at: Instant | null) => (at === null ? null : iso(at));

const SEASON_COLUMNS =
  "id, circle_id, time_zone, nominal_start, actual_start, length_weeks, review_cadence_weeks, status, pact_closed_at, created_at, version";

/** `($1, $2), ($3, $4)`-style placeholders for `rows` rows of `width` columns, `casts[i]` appended to column i. */
function placeholders(rows: number, width: number, casts: Record<number, string> = {}): string {
  return Array.from({ length: rows }, (_, r) => {
    const cells = Array.from({ length: width }, (_, c) => `$${r * width + c + 1}${casts[c] ?? ""}`);
    return `(${cells.join(", ")})`;
  }).join(", ");
}

/**
 * One instance per transaction (see `bindRepositories`). `guardVersion` and
 * `delete` arrive in B5b-ii and fail loudly until then: a silent no-op would
 * let a use case believe it had a lock or had deleted a season.
 */
export function createPgSeasonRepository(exec: SqlExecutor): SeasonRepository {
  /**
   * Torn reads: the three queries run at READ COMMITTED inside a write
   * transaction, so a concurrent commit between them can mix children of one
   * version with a root of another. The root is read FIRST, so such a commit
   * bumped the version past the one we hold, and a transaction that saves this
   * season fails its version-checked UPDATE (the season guard, B5b-ii, locks
   * it). A use case that only reads a season without guarding or saving it gets
   * no such protection. `read()` is one snapshot, so it never tears.
   */
  async function load(row: SeasonRow | undefined): Promise<Season | null> {
    if (!row) return null;
    if (!isSeasonLengthWeeks(row.length_weeks) || !isReviewCadenceWeeks(row.review_cadence_weeks)) {
      throw new Error(
        `season ${row.id}: corrupt length_weeks=${row.length_weeks} or review_cadence_weeks=${row.review_cadence_weeks}`,
      );
    }
    const commitments = await exec.query<CommitmentRow>(
      "select id, member_id, habit_id, weight_percent, privacy, measure from pactjoy.season_commitments where season_id = $1 order by position",
      [row.id],
    );
    const approvals = await exec.query<ApprovalRow>(
      "select member_id, approved_at from pactjoy.season_approvals where season_id = $1 order by position",
      [row.id],
    );
    return {
      id: seasonId(row.id),
      circleId: circleId(row.circle_id),
      timeZone: timeZoneId(row.time_zone),
      nominalStart: localDate(row.nominal_start),
      actualStart: row.actual_start === null ? null : localDate(row.actual_start),
      lengthWeeks: row.length_weeks,
      reviewCadenceWeeks: row.review_cadence_weeks,
      status: row.status,
      commitments: commitments.rows.map((c): CommitmentRecord => {
        try {
          return {
            id: commitmentId(c.id),
            memberId: memberId(c.member_id),
            habitId: habitId(c.habit_id),
            weightPercent: c.weight_percent,
            privacy: c.privacy,
            measure: decodeMeasure(c.measure),
          };
        } catch (cause) {
          throw new Error(`season ${row.id}: corrupt measure of commitment ${c.id}`, { cause });
        }
      }),
      approvals: approvals.rows.map(
        (a): PactApproval => ({ memberId: memberId(a.member_id), approvedAt: a.approved_at }),
      ),
      pactClosedAt: row.pact_closed_at,
      createdAt: row.created_at,
      version: row.version,
    };
  }

  const one = async (where: string, params: unknown[]) =>
    load(
      (
        await exec.query<SeasonRow>(
          `select ${SEASON_COLUMNS} from pactjoy.seasons ${where}`,
          params,
        )
      ).rows[0],
    );

  return {
    get: (id) => one("where id = $1", [id]),
    // `insert_seq` is the insertion order: an update never moves it, and equal `created_at` still tie-break.
    findLatestByCircle: (circle) =>
      one("where circle_id = $1 order by insert_seq desc limit 1", [circle]),

    async guardVersion() {
      throw new Error("PgSeasonRepository.guardVersion: not implemented (B5b-ii)");
    },
    /** Version-checked. The commitments and approvals go with it (ON DELETE CASCADE); entries will RESTRICT it. */
    async delete(id, expectedVersion) {
      const { rowCount } = await exec.query(
        "delete from pactjoy.seasons where id = $1 and version = $2",
        [id, expectedVersion],
      );
      if (rowCount === 0) throw new ConcurrencyConflict();
    },

    async save(season, expectedVersion) {
      if (expectedVersion === null) {
        // `insert_seq` is generated. A duplicate id raises 23505 on seasons_pkey, mapped to ConcurrencyConflict.
        await exec.query(
          "insert into pactjoy.seasons (id, circle_id, time_zone, nominal_start, actual_start, length_weeks, review_cadence_weeks, status, pact_closed_at, created_at, version) values ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11)",
          [
            season.id,
            season.circleId,
            season.timeZone,
            season.nominalStart,
            season.actualStart,
            season.lengthWeeks,
            season.reviewCadenceWeeks,
            season.status,
            isoOrNull(season.pactClosedAt),
            iso(season.createdAt),
            season.version,
          ],
        );
      } else {
        // Only mutable columns are SET: never `id`, `circle_id` or `insert_seq` (key columns, ADR-0010), nor `created_at`.
        const { rowCount } = await exec.query(
          "update pactjoy.seasons set time_zone = $2, nominal_start = $3::date, actual_start = $4::date, length_weeks = $5, review_cadence_weeks = $6, status = $7, pact_closed_at = $8::timestamptz, version = $9 where id = $1 and version = $10",
          [
            season.id,
            season.timeZone,
            season.nominalStart,
            season.actualStart,
            season.lengthWeeks,
            season.reviewCadenceWeeks,
            season.status,
            isoOrNull(season.pactClosedAt),
            season.version,
            expectedVersion,
          ],
        );
        if (rowCount === 0) throw new ConcurrencyConflict();
        await exec.query("delete from pactjoy.season_commitments where season_id = $1", [
          season.id,
        ]);
        await exec.query("delete from pactjoy.season_approvals where season_id = $1", [season.id]);
      }
      if (season.commitments.length > 0) {
        // `::text::jsonb`: postgres.js reads the jsonb parameter type from the server and would JSON.stringify the already-stringified payload again; `::text` makes it pass through.
        await exec.query(
          `insert into pactjoy.season_commitments (season_id, position, id, member_id, habit_id, weight_percent, privacy, measure) values ${placeholders(season.commitments.length, 8, { 7: "::text::jsonb" })}`,
          season.commitments.flatMap((c, position) => [
            season.id,
            position,
            c.id,
            c.memberId,
            c.habitId,
            c.weightPercent,
            c.privacy,
            JSON.stringify(encodeMeasure(c.measure)),
          ]),
        );
      }
      if (season.approvals.length > 0) {
        await exec.query(
          `insert into pactjoy.season_approvals (season_id, position, member_id, approved_at) values ${placeholders(season.approvals.length, 4, { 3: "::timestamptz" })}`,
          season.approvals.flatMap((a, position) => [
            season.id,
            position,
            a.memberId,
            iso(a.approvedAt),
          ]),
        );
      }
    },
  };
}
