import {
  type CommitmentReminder,
  type CommitmentReminderRepository,
  ConcurrencyConflict,
  commitmentId,
  type Instant,
  memberId,
  seasonId,
} from "@pactjoy/app";
import type { Weekday } from "@pactjoy/engine";
import type { SqlExecutor } from "../client.ts";

interface ReminderRow {
  season_id: string;
  commitment_id: string;
  member_id: string;
  enabled: boolean;
  minute_of_day: number;
  weekdays: number;
  updated_at: Instant;
  version: number;
}

const COLUMNS =
  "season_id, commitment_id, member_id, enabled, minute_of_day, weekdays, updated_at, version";

const iso = (at: Instant) => new Date(at).toISOString();

/** Engine weekdays to the 7-bit mask the table stores (bit 0 = Monday). */
function maskOf(weekdays: readonly Weekday[]): number {
  return weekdays.reduce<number>((mask, day) => mask | (1 << day), 0);
}

function weekdaysOf(mask: number): Weekday[] {
  const days: Weekday[] = [];
  for (let day = 0; day < 7; day += 1) if (mask & (1 << day)) days.push(day as Weekday);
  return days;
}

function toReminder(row: ReminderRow): CommitmentReminder {
  return {
    seasonId: seasonId(row.season_id),
    commitmentId: commitmentId(row.commitment_id),
    memberId: memberId(row.member_id),
    enabled: row.enabled,
    minuteOfDay: row.minute_of_day,
    weekdays: weekdaysOf(row.weekdays),
    updatedAt: row.updated_at,
    version: row.version,
  };
}

/**
 * Commitment reminders over `pactjoy.commitment_reminders` (ADR-0017 addendum, D2). One instance
 * per transaction (see `bindRepositories`). An insert that hits the primary key, or an update whose
 * version moved, is a {@link ConcurrencyConflict}, so the unit of work retries it.
 */
export function createPgCommitmentReminderRepository(
  exec: SqlExecutor,
): CommitmentReminderRepository {
  return {
    async get(season, commitment) {
      const { rows } = await exec.query<ReminderRow>(
        `select ${COLUMNS} from pactjoy.commitment_reminders where season_id = $1 and commitment_id = $2`,
        [season, commitment],
      );
      return rows[0] ? toReminder(rows[0]) : null;
    },

    async listEnabled(season) {
      const { rows } = await exec.query<ReminderRow>(
        `select ${COLUMNS} from pactjoy.commitment_reminders where season_id = $1 and enabled order by commitment_id`,
        [season],
      );
      return rows.map(toReminder);
    },

    async save(reminder, expectedVersion) {
      const values = [
        reminder.seasonId,
        reminder.commitmentId,
        reminder.memberId,
        reminder.enabled,
        reminder.minuteOfDay,
        maskOf(reminder.weekdays),
        iso(reminder.updatedAt),
        reminder.version,
      ];
      if (expectedVersion === null) {
        const { rowCount } = await exec.query(
          `insert into pactjoy.commitment_reminders (${COLUMNS}) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8) on conflict (season_id, commitment_id) do nothing`,
          values,
        );
        if (rowCount !== 1) throw new ConcurrencyConflict();
        return;
      }
      const { rowCount } = await exec.query(
        "update pactjoy.commitment_reminders set member_id = $3, enabled = $4, minute_of_day = $5, weekdays = $6, updated_at = $7::timestamptz, version = $8 where season_id = $1 and commitment_id = $2 and version = $9",
        [...values, expectedVersion],
      );
      if (rowCount !== 1) throw new ConcurrencyConflict();
    },

    async deleteByMembers(memberIds) {
      if (memberIds.length === 0) return;
      await exec.query(
        "delete from pactjoy.commitment_reminders where member_id = any($1::uuid[])",
        [memberIds],
      );
    },

    async deleteBySeasons(seasonIds) {
      if (seasonIds.length === 0) return;
      await exec.query(
        "delete from pactjoy.commitment_reminders where season_id = any($1::uuid[])",
        [seasonIds],
      );
    },
  };
}
