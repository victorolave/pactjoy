import { describe, expect, it } from "vitest";
import type { PushSubscriptionRecord } from "../notifications/push-subscription.repository.ts";
import type { Repositories } from "../ports/repositories.ts";
import { pushSubscriptionId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { pushSubscriptionFixture } from "../testing/notification-fixtures.ts";
import { instant } from "../time/instant.ts";
import type { ContractSubject } from "./fixtures.ts";

type SubscriptionRepositories = Pick<Repositories, "pushSubscriptions">;

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = 1_791_987_120_000;
const ANDREA = userId(uuid(0xb1));
const VICTOR = userId(uuid(0xb2));

const device = (n: number, extra: Partial<PushSubscriptionRecord> = {}): PushSubscriptionRecord =>
  pushSubscriptionFixture({
    id: pushSubscriptionId(uuid(0x500 + n)),
    userId: ANDREA,
    endpoint: `https://web.push.apple.com/device-${n}`,
    createdAt: instant(T0 + n),
    lastSeenAt: instant(T0 + n),
    ...extra,
  });

/**
 * `PushSubscriptionRepository` contract (ADR-0017), adapter-neutral, driven through the unit of
 * work. The factory must return an EMPTY store. Subscriptions are user-level and have no foreign
 * keys, so nothing needs seeding.
 */
export function describePushSubscriptionContract(
  name: string,
  factory: () => Promise<ContractSubject<SubscriptionRepositories>>,
): void {
  describe(`PushSubscriptionRepository contract (${name})`, () => {
    async function subject() {
      const { uow } = await factory();
      const tx = <T>(run: (repos: SubscriptionRepositories) => Promise<T>) =>
        uow
          .transaction(async (repos) => ok(await run(repos)))
          .then((r) => (r.ok ? r.value : (undefined as T)));
      return {
        upsert: (...records: PushSubscriptionRecord[]) =>
          tx(async ({ pushSubscriptions }) => {
            for (const record of records) await pushSubscriptions.upsert(record);
          }),
        list: (user = ANDREA) =>
          uow.read(({ pushSubscriptions }) => pushSubscriptions.listByUser(user)),
        tx,
      };
    }

    it("lists nothing for a user without devices", async () => {
      const s = await subject();
      expect(await s.list()).toEqual([]);
    });

    it("stores a subscription and lists it back as given", async () => {
      const s = await subject();
      await s.upsert(device(1));
      expect(await s.list()).toEqual([device(1)]);
    });

    it("keeps several devices per user, most recently seen first", async () => {
      const s = await subject();
      await s.upsert(device(1), device(3), device(2));
      expect((await s.list()).map((d) => d.endpoint)).toEqual([
        device(3).endpoint,
        device(2).endpoint,
        device(1).endpoint,
      ]);
    });

    it("re-registering an endpoint refreshes its keys and lastSeenAt, keeping one row (SC-X2)", async () => {
      const s = await subject();
      await s.upsert(device(1));
      const again = device(1, {
        id: pushSubscriptionId(uuid(0x5ff)),
        p256dh: `B${"Q".repeat(86)}`,
        auth: "Q".repeat(22),
        createdAt: instant(T0 + 50),
        lastSeenAt: instant(T0 + 50),
      });
      await s.upsert(again);
      expect(await s.list()).toEqual([
        { ...device(1), p256dh: again.p256dh, auth: again.auth, lastSeenAt: again.lastSeenAt },
      ]);
    });

    it("an endpoint registered by another user moves to that user (SC-X3)", async () => {
      const s = await subject();
      await s.upsert(device(1));
      await s.upsert(device(1, { userId: VICTOR, lastSeenAt: instant(T0 + 9) }));
      expect(await s.list(ANDREA)).toEqual([]);
      expect((await s.list(VICTOR)).map((d) => [d.id, d.userId])).toEqual([[device(1).id, VICTOR]]);
    });

    it("remove deletes only the caller's own endpoint and is idempotent (SC-X5)", async () => {
      const s = await subject();
      await s.upsert(device(1), device(2));
      await s.tx(({ pushSubscriptions }) => pushSubscriptions.remove(VICTOR, device(1).endpoint));
      expect(await s.list()).toHaveLength(2);
      await s.tx(({ pushSubscriptions }) => pushSubscriptions.remove(ANDREA, device(1).endpoint));
      await s.tx(({ pushSubscriptions }) => pushSubscriptions.remove(ANDREA, device(1).endpoint));
      expect((await s.list()).map((d) => d.endpoint)).toEqual([device(2).endpoint]);
    });

    it("removeById deletes that device and is idempotent", async () => {
      const s = await subject();
      await s.upsert(device(1), device(2));
      await s.tx(({ pushSubscriptions }) => pushSubscriptions.removeById(device(2).id));
      await s.tx(({ pushSubscriptions }) => pushSubscriptions.removeById(device(2).id));
      expect((await s.list()).map((d) => d.id)).toEqual([device(1).id]);
    });

    it("trimOldest keeps the user's most recently seen devices only", async () => {
      const s = await subject();
      await s.upsert(device(1), device(2), device(3), device(4, { userId: VICTOR }));
      await s.tx(({ pushSubscriptions }) => pushSubscriptions.trimOldest(ANDREA, 2));
      expect((await s.list()).map((d) => d.id)).toEqual([device(3).id, device(2).id]);
      expect(await s.list(VICTOR)).toHaveLength(1);
    });

    it("removeAllOfUser deletes every device of that user only, and is idempotent", async () => {
      const s = await subject();
      await s.upsert(device(1), device(2), device(3, { userId: VICTOR }));
      await s.tx(({ pushSubscriptions }) => pushSubscriptions.removeAllOfUser(ANDREA));
      await s.tx(({ pushSubscriptions }) => pushSubscriptions.removeAllOfUser(ANDREA));
      expect(await s.list(ANDREA)).toEqual([]);
      expect((await s.list(VICTOR)).map((d) => d.id)).toEqual([device(3).id]);
    });
  });
}
