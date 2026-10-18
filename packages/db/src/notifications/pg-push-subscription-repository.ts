import {
  type Instant,
  type PushSubscriptionRecord,
  type PushSubscriptionRepository,
  pushSubscriptionId,
  userId,
} from "@pactjoy/app";
import type { SqlExecutor } from "../client.ts";

interface SubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: Instant;
  last_seen_at: Instant;
}

const COLUMNS = "id, user_id, endpoint, p256dh, auth, created_at, last_seen_at";

const iso = (at: Instant) => new Date(at).toISOString();

function toRecord(row: SubscriptionRow): PushSubscriptionRecord {
  return {
    id: pushSubscriptionId(row.id),
    userId: userId(row.user_id),
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * Web Push subscriptions over `pactjoy.push_subscriptions` (ADR-0017). One instance per
 * transaction (see `bindRepositories`). `upsert` is `ON CONFLICT (endpoint) DO UPDATE`: the row
 * keeps its id and `created_at` and moves to the new user with the new keys.
 */
export function createPgPushSubscriptionRepository(exec: SqlExecutor): PushSubscriptionRepository {
  return {
    async upsert(record) {
      await exec.query(
        "insert into pactjoy.push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, last_seen_at) values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz) on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, last_seen_at = excluded.last_seen_at",
        [
          record.id,
          record.userId,
          record.endpoint,
          record.p256dh,
          record.auth,
          iso(record.createdAt),
          iso(record.lastSeenAt),
        ],
      );
    },

    async remove(user, endpoint) {
      await exec.query(
        "delete from pactjoy.push_subscriptions where user_id = $1 and endpoint = $2",
        [user, endpoint],
      );
    },

    async removeById(id) {
      await exec.query("delete from pactjoy.push_subscriptions where id = $1", [id]);
    },

    async removeAllOfUser(user) {
      await exec.query("delete from pactjoy.push_subscriptions where user_id = $1", [user]);
    },

    async listByUser(user) {
      const { rows } = await exec.query<SubscriptionRow>(
        `select ${COLUMNS} from pactjoy.push_subscriptions where user_id = $1 order by last_seen_at desc, id`,
        [user],
      );
      return rows.map(toRecord);
    },

    async trimOldest(user, keep) {
      await exec.query(
        "delete from pactjoy.push_subscriptions where user_id = $1 and id not in (select id from pactjoy.push_subscriptions where user_id = $1 order by last_seen_at desc, id limit $2)",
        [user, keep],
      );
    },
  };
}
