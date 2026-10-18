import {
  circleId,
  type Instant,
  memberId,
  type NoticeOutcome,
  type NoticeState,
  type NotificationOutboxRepository,
  type OutboxNotice,
  seasonId,
  timeZoneId,
  userId,
} from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

interface OutboxRow {
  dedupe_key: string;
  kind: OutboxNotice["kind"];
  params: unknown;
  circle_id: string;
  season_id: string | null;
  recipient_member_id: string;
  recipient_user_id: string;
  time_zone: string;
  not_before: Instant;
  expires_at: Instant;
  rollovers_left: number;
  state: NoticeState;
  attempts: number;
  lease_until: Instant | null;
  outcome: NoticeOutcome | null;
  created_at: Instant;
  finished_at: Instant | null;
}

const COLUMNS =
  "dedupe_key, kind, params, circle_id, season_id, recipient_member_id, recipient_user_id, time_zone, not_before, expires_at, rollovers_left, state, attempts, lease_until, outcome, created_at, finished_at";

const iso = (at: Instant) => new Date(at).toISOString();

/** Oldest `not_before` first, ties by key in code-unit order (the `collate "C"` of the SQL). */
const byDue = (a: OutboxNotice, b: OutboxNotice) =>
  a.notBefore - b.notBefore || (a.dedupeKey < b.dedupeKey ? -1 : 1);

function toNotice(row: OutboxRow): OutboxNotice {
  const params = typeof row.params === "string" ? JSON.parse(row.params) : row.params;
  return {
    dedupeKey: row.dedupe_key,
    kind: row.kind,
    params,
    circleId: circleId(row.circle_id),
    seasonId: row.season_id === null ? null : seasonId(row.season_id),
    recipientMemberId: memberId(row.recipient_member_id),
    recipientUserId: userId(row.recipient_user_id),
    timeZone: timeZoneId(row.time_zone),
    notBefore: row.not_before,
    expiresAt: row.expires_at,
    rolloversLeft: row.rollovers_left === 1 ? 1 : 0,
    state: row.state,
    attempts: row.attempts,
    leaseUntil: row.lease_until,
    outcome: row.outcome,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  } as OutboxNotice;
}

/**
 * The transactional outbox over `pactjoy.notification_outbox` (ADR-0017). One instance per
 * transaction (see `bindRepositories`).
 *
 * `enqueue` is `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING`, so a repeated key never raises.
 * `claimDue` is ONE UPDATE ... RETURNING over a `FOR UPDATE SKIP LOCKED` selection: concurrent
 * dispatchers take disjoint rows and never wait on each other. `finish` and `reschedule` are fenced
 * by `state = 'sending' AND attempts = $claimed`; the affected-row count is the answer.
 */
export function createPgNotificationOutboxRepository(
  exec: SqlExecutor,
): NotificationOutboxRepository {
  return {
    async enqueue(notices) {
      let added = 0;
      for (const notice of notices) {
        // `::text::jsonb`: postgres.js would JSON.stringify an already-stringified jsonb parameter again.
        const { rowCount } = await exec.query(
          "insert into pactjoy.notification_outbox (dedupe_key, kind, params, circle_id, season_id, recipient_member_id, recipient_user_id, time_zone, not_before, expires_at, rollovers_left, state, attempts, lease_until, outcome, created_at, finished_at) values ($1, $2, $3::text::jsonb, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, 'pending', 0, null, null, $12::timestamptz, null) on conflict (dedupe_key) do nothing",
          [
            notice.dedupeKey,
            notice.kind,
            JSON.stringify(notice.params),
            notice.circleId,
            notice.seasonId,
            notice.recipientMemberId,
            notice.recipientUserId,
            notice.timeZone,
            iso(notice.notBefore),
            iso(notice.expiresAt),
            notice.rolloversLeft,
            iso(notice.createdAt),
          ],
        );
        added += rowCount;
      }
      return added;
    },

    async claimDue(now, leaseUntil, limit) {
      const { rows } = await exec.query<OutboxRow>(
        `update pactjoy.notification_outbox set state = 'sending', attempts = attempts + 1, lease_until = $2::timestamptz where dedupe_key in (select dedupe_key from pactjoy.notification_outbox where (state = 'pending' and not_before <= $1::timestamptz) or (state = 'sending' and lease_until <= $1::timestamptz) order by not_before, dedupe_key collate "C" limit $3 for update skip locked) returning ${COLUMNS}`,
        [iso(now), iso(leaseUntil), limit],
      );
      return rows.map(toNotice).sort(byDue);
    },

    async reschedule(key, claimedAttempts, next) {
      const { rowCount } = await exec.query(
        "update pactjoy.notification_outbox set state = 'pending', lease_until = null, not_before = $3::timestamptz, expires_at = $4::timestamptz, rollovers_left = $5, attempts = $6 where dedupe_key = $1 and state = 'sending' and attempts = $2",
        [
          key,
          claimedAttempts,
          iso(next.notBefore),
          iso(next.expiresAt),
          next.rolloversLeft,
          next.attempts,
        ],
      );
      return rowCount === 1;
    },

    async finish(key, claimedAttempts, state, outcome, at) {
      const { rowCount } = await exec.query(
        "update pactjoy.notification_outbox set state = $3, outcome = $4, finished_at = $5::timestamptz, lease_until = null where dedupe_key = $1 and state = 'sending' and attempts = $2",
        [key, claimedAttempts, state, outcome, iso(at)],
      );
      return rowCount === 1;
    },

    async purgeFinished(finishedBefore, limit) {
      const { rowCount } = await exec.query(
        "delete from pactjoy.notification_outbox where dedupe_key in (select dedupe_key from pactjoy.notification_outbox where state in ('sent', 'dropped', 'failed') and finished_at < $1::timestamptz order by finished_at limit $2 for update skip locked)",
        [iso(finishedBefore), limit],
      );
      return rowCount;
    },
  };
}
