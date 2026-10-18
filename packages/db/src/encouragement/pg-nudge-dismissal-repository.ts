import {
  type Instant,
  type LocalDate,
  memberId,
  type NudgeDismissalRepository,
  seasonId,
} from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

interface DismissalRow {
  season_id: string;
  viewer_member_id: string;
  target_member_id: string;
  case_week: number;
  dismissed_at: Instant;
  dismissed_on: LocalDate;
}

/**
 * The NudgeDismissal rows (`nudge_dismissals`). One instance per transaction (see
 * `bindRepositories`). Owner-only (`listMine` takes the viewer) and insert-once: `add` is
 * IDEMPOTENT through `ON CONFLICT DO NOTHING` on the primary key, so a double tap or a race keeps
 * the first dismissal and raises nothing.
 */
export function createPgNudgeDismissalRepository(exec: SqlExecutor): NudgeDismissalRepository {
  return {
    async listMine(season, viewer) {
      const { rows } = await exec.query<DismissalRow>(
        "select season_id, viewer_member_id, target_member_id, case_week, dismissed_at, dismissed_on from pactjoy.nudge_dismissals where season_id = $1 and viewer_member_id = $2 order by dismissed_at, target_member_id, case_week",
        [season, viewer],
      );
      return rows.map((row) => ({
        seasonId: seasonId(row.season_id),
        viewerId: memberId(row.viewer_member_id),
        targetId: memberId(row.target_member_id),
        caseWeek: row.case_week,
        dismissedAt: row.dismissed_at,
        dismissedOn: row.dismissed_on,
      }));
    },

    async add(d) {
      await exec.query(
        "insert into pactjoy.nudge_dismissals (season_id, viewer_member_id, target_member_id, case_week, dismissed_at, dismissed_on) values ($1, $2, $3, $4, $5::timestamptz, $6::date) on conflict (season_id, viewer_member_id, target_member_id, case_week) do nothing",
        [
          d.seasonId,
          d.viewerId,
          d.targetId,
          d.caseWeek,
          new Date(d.dismissedAt).toISOString(),
          d.dismissedOn,
        ],
      );
    },
  };
}
