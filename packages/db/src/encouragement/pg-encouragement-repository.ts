import {
  type Encouragement,
  type EncouragementRepository,
  encouragementId,
  type Instant,
  type LocalDate,
  memberId,
  type ReactionEmoji,
  seasonId,
} from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

interface EncouragementRow {
  id: string;
  season_id: string;
  sender_member_id: string;
  recipient_member_id: string;
  case_week: number;
  emoji: ReactionEmoji;
  sent_at: Instant;
  sent_on: LocalDate;
}

const COLUMNS =
  "id, season_id, sender_member_id, recipient_member_id, case_week, emoji, sent_at, sent_on";

const toEncouragement = (row: EncouragementRow): Encouragement => ({
  id: encouragementId(row.id),
  seasonId: seasonId(row.season_id),
  senderId: memberId(row.sender_member_id),
  recipientId: memberId(row.recipient_member_id),
  caseWeek: row.case_week,
  emoji: row.emoji,
  sentAt: row.sent_at,
  sentOn: row.sent_on,
});

/**
 * The Encouragement aggregate over one table (`encouragements`). One instance per transaction (see
 * `bindRepositories`). Insert-only. There is deliberately no season-wide read: only the sender's
 * and the recipient's own rows can be listed, plus `get` by id for the push hook.
 *
 * `add` can hit `encouragements_pkey`, `encouragements_case_key` or `encouragements_daily_key`
 * (23505), which the unit of work maps to ConcurrencyConflict: the atomic guard behind "one
 * encouragement per case" and "one per person per day".
 */
export function createPgEncouragementRepository(exec: SqlExecutor): EncouragementRepository {
  return {
    async listSent(season, sender) {
      const { rows } = await exec.query<EncouragementRow>(
        `select ${COLUMNS} from pactjoy.encouragements where season_id = $1 and sender_member_id = $2 order by sent_at, id`,
        [season, sender],
      );
      return rows.map(toEncouragement);
    },

    async listReceived(season, recipient) {
      const { rows } = await exec.query<EncouragementRow>(
        `select ${COLUMNS} from pactjoy.encouragements where season_id = $1 and recipient_member_id = $2 order by sent_at, id`,
        [season, recipient],
      );
      return rows.map(toEncouragement);
    },

    async get(id) {
      const { rows } = await exec.query<EncouragementRow>(
        `select ${COLUMNS} from pactjoy.encouragements where id = $1`,
        [id],
      );
      const row = rows[0];
      return row ? toEncouragement(row) : null;
    },

    async add(e) {
      await exec.query(
        "insert into pactjoy.encouragements (id, season_id, sender_member_id, recipient_member_id, case_week, emoji, sent_at, sent_on) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::date)",
        [
          e.id,
          e.seasonId,
          e.senderId,
          e.recipientId,
          e.caseWeek,
          e.emoji,
          new Date(e.sentAt).toISOString(),
          e.sentOn,
        ],
      );
    },

    async deleteByRecipients(memberIds) {
      if (memberIds.length === 0) return;
      await exec.query(
        "delete from pactjoy.encouragements where recipient_member_id = any($1::uuid[])",
        [memberIds],
      );
    },

    async deleteBySeasons(seasonIds) {
      if (seasonIds.length === 0) return;
      await exec.query("delete from pactjoy.encouragements where season_id = any($1::uuid[])", [
        seasonIds,
      ]);
    },
  };
}
