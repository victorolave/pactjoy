import type { Instant } from "@pactjoy/app";
import {
  ConcurrencyConflict,
  type Habit,
  type HabitRepository,
  habitId,
  userId,
} from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

interface HabitRow {
  id: string;
  owner_id: string;
  name: string;
  why: string | null;
  category: string | null;
  icon: string | null;
  created_at: Instant;
  version: number;
}

const COLUMNS = "id, owner_id, name, why, category, icon, created_at, version";

function toHabit(row: HabitRow): Habit {
  return {
    id: habitId(row.id),
    ownerId: userId(row.owner_id),
    name: row.name,
    why: row.why,
    category: row.category,
    icon: row.icon,
    createdAt: row.created_at,
    version: row.version,
  };
}

/** Ids bind as text and Postgres infers uuid from the column; a non-uuid id is a raw error (HP-S11). */
export function createPgHabitRepository(exec: SqlExecutor): HabitRepository {
  return {
    async get(id) {
      const { rows } = await exec.query<HabitRow>(
        `select ${COLUMNS} from pactjoy.habits where id = $1`,
        [id],
      );
      const row = rows[0];
      return row ? toHabit(row) : null;
    },

    // Newest first; the id tie-break keeps the order deterministic.
    async listByOwner(ownerId) {
      const { rows } = await exec.query<HabitRow>(
        `select ${COLUMNS} from pactjoy.habits where owner_id = $1 order by created_at desc, id`,
        [ownerId],
      );
      return rows.map(toHabit);
    },

    // A single query; `= any` already collapses repeated ids. No query at all for no ids.
    async getMany(ids) {
      if (ids.length === 0) return [];
      const { rows } = await exec.query<HabitRow>(
        `select ${COLUMNS} from pactjoy.habits where id = any($1::uuid[])`,
        [[...ids]],
      );
      return rows.map(toHabit);
    },

    async save(habit: Habit, expectedVersion) {
      const createdAt = new Date(habit.createdAt).toISOString();
      if (expectedVersion === null) {
        // A duplicate id raises 23505 on habits_pkey, which the unit of work maps to ConcurrencyConflict.
        await exec.query(
          "insert into pactjoy.habits (id, owner_id, name, why, category, icon, created_at, version) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)",
          [
            habit.id,
            habit.ownerId,
            habit.name,
            habit.why,
            habit.category,
            habit.icon,
            createdAt,
            habit.version,
          ],
        );
        return;
      }
      // The key column (id) is never in SET: updating one would upgrade the row lock (ADR-0010).
      const { rowCount } = await exec.query(
        "update pactjoy.habits set owner_id = $2, name = $3, why = $4, category = $5, icon = $6, created_at = $7::timestamptz, version = $8 where id = $1 and version = $9",
        [
          habit.id,
          habit.ownerId,
          habit.name,
          habit.why,
          habit.category,
          habit.icon,
          createdAt,
          habit.version,
          expectedVersion,
        ],
      );
      if (rowCount === 0) throw new ConcurrencyConflict();
    },
  };
}
