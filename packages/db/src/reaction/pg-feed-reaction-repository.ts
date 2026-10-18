import {
  ConcurrencyConflict,
  type FeedReaction,
  type FeedReactionRepository,
  feedReactionId,
  type Instant,
  memberId,
  type ReactionEmoji,
  seasonId,
} from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

interface ReactionRow {
  id: string;
  season_id: string;
  item_key: string;
  member_id: string;
  emoji: ReactionEmoji;
  reacted_at: Instant;
  version: number;
}

const COLUMNS = "id, season_id, item_key, member_id, emoji, reacted_at, version";

const iso = (at: Instant) => new Date(at).toISOString();

const toReaction = (row: ReactionRow): FeedReaction => ({
  id: feedReactionId(row.id),
  seasonId: seasonId(row.season_id),
  itemKey: row.item_key,
  memberId: memberId(row.member_id),
  emoji: row.emoji,
  reactedAt: row.reacted_at,
  version: row.version,
});

/**
 * The FeedReaction aggregate over one table (`feed_reactions`). One instance per transaction (see
 * `bindRepositories`).
 *
 * `expectedVersion` null inserts: a duplicate id or `(season_id, item_key, member_id)` raises
 * 23505 on `feed_reactions_pkey` / `feed_reactions_season_item_member_key`, which the unit of work
 * maps to ConcurrencyConflict (that is what keeps two racing sets to one row). Otherwise a
 * version-checked UPDATE of the mutable columns (emoji, version): `reacted_at` and the key columns
 * are never SET (ADR-0010).
 */
export function createPgFeedReactionRepository(exec: SqlExecutor): FeedReactionRepository {
  return {
    async listBySeason(season) {
      const { rows } = await exec.query<ReactionRow>(
        `select ${COLUMNS} from pactjoy.feed_reactions where season_id = $1 order by reacted_at, id`,
        [season],
      );
      return rows.map(toReaction);
    },

    async find(season, itemKey, member) {
      const { rows } = await exec.query<ReactionRow>(
        `select ${COLUMNS} from pactjoy.feed_reactions where season_id = $1 and item_key = $2 and member_id = $3`,
        [season, itemKey, member],
      );
      const row = rows[0];
      return row ? toReaction(row) : null;
    },

    async save(reaction, expectedVersion) {
      if (expectedVersion === null) {
        await exec.query(
          "insert into pactjoy.feed_reactions (id, season_id, item_key, member_id, emoji, reacted_at, version) values ($1, $2, $3, $4, $5, $6::timestamptz, $7)",
          [
            reaction.id,
            reaction.seasonId,
            reaction.itemKey,
            reaction.memberId,
            reaction.emoji,
            iso(reaction.reactedAt),
            reaction.version,
          ],
        );
        return;
      }
      const { rowCount } = await exec.query(
        "update pactjoy.feed_reactions set emoji = $2, version = $3 where id = $1 and version = $4",
        [reaction.id, reaction.emoji, reaction.version, expectedVersion],
      );
      if (rowCount === 0) throw new ConcurrencyConflict();
    },

    async remove(id, expectedVersion) {
      const { rowCount } = await exec.query(
        "delete from pactjoy.feed_reactions where id = $1 and version = $2",
        [id, expectedVersion],
      );
      if (rowCount === 0) throw new ConcurrencyConflict();
    },
  };
}
