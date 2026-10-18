import { memberId } from "../circle/circle.ts";
import type { OutboxNotice } from "../notifications/outbox-notice.ts";
import type { PushSubscriptionRecord } from "../notifications/push-subscription.repository.ts";
import { circleId, pushSubscriptionId, seasonId, userId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { timeZoneId } from "../time/time-zone.port.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = 1_791_987_120_000; // 2026-10-14T14:12:00Z

/** A pending `seasonStarted` notice with valid uuids; override what the test is about. */
export function outboxNoticeFixture(overrides: Partial<OutboxNotice> = {}): OutboxNotice {
  return {
    dedupeKey: "seasonStarted:season-1:member-1",
    kind: "seasonStarted",
    params: { seasonId: seasonId(uuid(0xe1)) },
    circleId: circleId(uuid(0xc1)),
    seasonId: seasonId(uuid(0xe1)),
    recipientMemberId: memberId(uuid(0xa1)),
    recipientUserId: userId(uuid(0xb1)),
    timeZone: timeZoneId("America/Bogota"),
    notBefore: instant(T0),
    expiresAt: instant(T0 + 24 * 3_600_000),
    rolloversLeft: 0,
    state: "pending",
    attempts: 0,
    leaseUntil: null,
    outcome: null,
    createdAt: instant(T0),
    finishedAt: null,
    ...overrides,
  } as OutboxNotice;
}

/** A device subscription with keys of the right shape (65-byte point, 16-byte secret, base64url). */
export function pushSubscriptionFixture(
  overrides: Partial<PushSubscriptionRecord> = {},
): PushSubscriptionRecord {
  return {
    id: pushSubscriptionId(uuid(0x501)),
    userId: userId(uuid(0xb1)),
    endpoint: "https://web.push.apple.com/QGuQyavXutnMH-device-1",
    p256dh: `B${"A".repeat(86)}`,
    auth: "A".repeat(22),
    createdAt: instant(T0),
    lastSeenAt: instant(T0),
    ...overrides,
  };
}
