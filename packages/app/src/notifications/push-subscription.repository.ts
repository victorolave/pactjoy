import type { PushSubscriptionId, UserId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";

/** One device's Web Push subscription (ADR-0017). Keys are base64url, as the browser gives them. */
export interface PushSubscriptionRecord {
  readonly id: PushSubscriptionId;
  readonly userId: UserId;
  /** The push service URL the server POSTs to: https on an allowlisted host (`PushSender.accepts`). */
  readonly endpoint: string;
  /** The device's P-256 public key: 65 bytes, uncompressed. */
  readonly p256dh: string;
  /** The device's auth secret: 16 bytes. */
  readonly auth: string;
  readonly createdAt: Instant;
  readonly lastSeenAt: Instant;
}

/** Most devices kept per user: saving one more drops the least recently seen. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * Storage port of the push subscriptions (ADR-0017). Confined to `src/notifications/`
 * (`notification-guard.test.ts`): an endpoint and its keys never reach any other module.
 */
export interface PushSubscriptionRepository {
  /**
   * Stores the subscription. The endpoint is unique: one already stored (for this user or ANOTHER)
   * is rebound to `record.userId` with the new keys and `lastSeenAt`, keeping its id and
   * `createdAt` (one endpoint, one user: REQ-X1).
   */
  upsert(record: PushSubscriptionRecord): Promise<void>;
  /** Removes the user's subscription with that endpoint; anyone else's is untouched. Idempotent. */
  remove(userId: UserId, endpoint: string): Promise<void>;
  /** Removes one subscription by id (a 404/410 from its push service). Idempotent. */
  removeById(id: PushSubscriptionId): Promise<void>;
  /** The user's subscriptions, most recently seen first. */
  listByUser(userId: UserId): Promise<readonly PushSubscriptionRecord[]>;
  /** Keeps only the user's `keep` most recently seen subscriptions. */
  trimOldest(userId: UserId, keep: number): Promise<void>;
}
