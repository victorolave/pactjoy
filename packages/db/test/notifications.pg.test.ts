import {
  circleId,
  instant,
  memberId,
  NOTIFICATION_KINDS,
  type OutboxNotice,
  ok,
  seasonId,
  timeZoneId,
  userId,
} from "@pactjoy/app";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

// Pool >= 2: the concurrency case keeps two claims in flight at once.
const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
afterAll(async () => {
  await truncateAll(admin);
  await client.end();
  await admin.end();
});
beforeEach(async () => {
  await truncateAll(admin);
});

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = 1_791_987_120_000;

const outboxNotice = (dedupeKey: string, notBefore: number): OutboxNotice => ({
  dedupeKey,
  kind: "seasonStarted",
  params: { seasonId: seasonId(uuid(0xe1)) },
  circleId: circleId(uuid(0xc1)),
  seasonId: seasonId(uuid(0xe1)),
  recipientMemberId: memberId(uuid(0xa1)),
  recipientUserId: userId(uuid(0xb1)),
  timeZone: timeZoneId("America/Bogota"),
  notBefore: instant(notBefore),
  expiresAt: instant(notBefore + 86_400_000),
  rolloversLeft: 0,
  state: "pending",
  attempts: 0,
  leaseUntil: null,
  outcome: null,
  createdAt: instant(T0),
  finishedAt: null,
});

const violates = async (run: () => PromiseLike<unknown>, constraint: string) => {
  const error = await Promise.resolve(run()).then(
    () => null,
    (e: unknown) => e as { code?: string; constraint_name?: string },
  );
  expect(error).toMatchObject({ code: expect.stringMatching(/^23/), constraint_name: constraint });
};

const insertNotice = (extra: Record<string, unknown> = {}) => {
  const row = {
    dedupe_key: "k",
    kind: "seasonStarted",
    params: admin.json({ seasonId: uuid(0xe1) }),
    circle_id: uuid(0xc1),
    season_id: uuid(0xe1),
    recipient_member_id: uuid(0xa1),
    recipient_user_id: uuid(0xb1),
    time_zone: "America/Bogota",
    not_before: "2026-10-14T14:00:00Z",
    expires_at: "2026-10-15T14:00:00Z",
    rollovers_left: 0,
    state: "pending",
    attempts: 0,
    lease_until: null,
    outcome: null,
    created_at: "2026-10-14T14:00:00Z",
    finished_at: null,
    ...extra,
  };
  return admin`insert into pactjoy.notification_outbox ${admin(row)}`;
};

const insertSubscription = (extra: Record<string, unknown> = {}) => {
  const row = {
    id: uuid(0x501),
    user_id: uuid(0xb1),
    endpoint: "https://web.push.apple.com/device-1",
    p256dh: `B${"A".repeat(86)}`,
    auth: "A".repeat(22),
    created_at: "2026-10-14T14:00:00Z",
    last_seen_at: "2026-10-14T14:00:00Z",
    ...extra,
  };
  return admin`insert into pactjoy.push_subscriptions ${admin(row)}`;
};

describe("pactjoy.notification_outbox constraints", () => {
  it("accepts exactly the kinds of the closed NotificationKind union", async () => {
    for (const [i, kind] of NOTIFICATION_KINDS.entries()) {
      await insertNotice({ dedupe_key: `k${i}`, kind });
    }
    await violates(() => insertNotice({ kind: "overtaken" }), "notification_outbox_kind_check");
  });

  it("has representational CHECKs on params, rollovers, state, attempts, outcome and key length", async () => {
    await violates(
      () => insertNotice({ params: admin.json([1]) }),
      "notification_outbox_params_check",
    );
    await violates(
      () => insertNotice({ rollovers_left: 2 }),
      "notification_outbox_rollovers_left_check",
    );
    await violates(() => insertNotice({ state: "queued" }), "notification_outbox_state_check");
    await violates(() => insertNotice({ attempts: -1 }), "notification_outbox_attempts_check");
    await violates(
      () => insertNotice({ state: "sent", outcome: "opened", finished_at: "2026-10-14T15:00:00Z" }),
      "notification_outbox_outcome_check",
    );
    await violates(
      () => insertNotice({ dedupe_key: "x".repeat(201) }),
      "notification_outbox_dedupe_key_check",
    );
  });

  it("ties the lease to `sending` and the finish time and outcome to a final state", async () => {
    await violates(() => insertNotice({ state: "sending" }), "notification_outbox_lease_check");
    await violates(
      () => insertNotice({ lease_until: "2026-10-14T15:00:00Z" }),
      "notification_outbox_lease_check",
    );
    await violates(() => insertNotice({ state: "sent" }), "notification_outbox_finished_check");
    await violates(
      () => insertNotice({ outcome: "delivered", finished_at: "2026-10-14T15:00:00Z" }),
      "notification_outbox_finished_check",
    );
    await insertNotice({
      state: "dropped",
      outcome: "expired",
      finished_at: "2026-10-14T15:00:00Z",
    });
  });

  it("two concurrent claims take disjoint rows (FOR UPDATE SKIP LOCKED)", async () => {
    const rows: OutboxNotice[] = Array.from({ length: 20 }, (_, i) =>
      outboxNotice(`k${String(i).padStart(2, "0")}`, T0 + i),
    );
    await uow.transaction(async ({ notifications }) => ok(await notifications.enqueue(rows)));
    const claim = () =>
      uow.transaction(async ({ notifications }) =>
        ok(await notifications.claimDue(instant(T0 + 100), instant(T0 + 400_000), 15)),
      );
    const [a, b] = await Promise.all([claim(), claim()]);
    const keysA = a.ok ? a.value.map((n) => n.dedupeKey) : [];
    const keysB = b.ok ? b.value.map((n) => n.dedupeKey) : [];
    expect(keysA.filter((key) => keysB.includes(key))).toEqual([]);
    expect([...keysA, ...keysB].sort()).toEqual(rows.map((n) => n.dedupeKey));
  });
});

describe("pactjoy.push_subscriptions constraints", () => {
  it("keeps one row per endpoint and checks the shape of the endpoint and keys", async () => {
    await insertSubscription();
    await violates(
      () => insertSubscription({ id: uuid(0x502) }),
      "push_subscriptions_endpoint_key",
    );
    await violates(
      () => insertSubscription({ id: uuid(0x503), endpoint: "http://web.push.apple.com/x" }),
      "push_subscriptions_endpoint_check",
    );
    await violates(
      () =>
        insertSubscription({
          id: uuid(0x504),
          endpoint: `https://web.push.apple.com/${"x".repeat(1000)}`,
        }),
      "push_subscriptions_endpoint_check",
    );
    await violates(
      () => insertSubscription({ id: uuid(0x505), endpoint: "https://a/2", p256dh: "short" }),
      "push_subscriptions_p256dh_check",
    );
    await violates(
      () => insertSubscription({ id: uuid(0x506), endpoint: "https://a/3", auth: "a+b/" }),
      "push_subscriptions_auth_check",
    );
  });
});

describe("no foreign keys from the notification tables (agy #3, ADR-0017)", () => {
  it("neither table references another table", async () => {
    const fks = await admin`
      select conname from pg_constraint
      where contype = 'f' and conrelid in (
        'pactjoy.notification_outbox'::regclass, 'pactjoy.push_subscriptions'::regclass
      )`;
    expect(fks).toEqual([]);
  });
});
