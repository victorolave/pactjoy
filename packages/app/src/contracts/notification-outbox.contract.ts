import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import type { OutboxNotice } from "../notifications/outbox-notice.ts";
import type { Repositories } from "../ports/repositories.ts";
import { circleId, pauseRequestId, seasonId, userId } from "../shared/ids.ts";
import { err, ok } from "../shared/result.ts";
import { outboxNoticeFixture } from "../testing/notification-fixtures.ts";
import { instant } from "../time/instant.ts";
import { localDate } from "../time/local-date.ts";
import type { ContractSubject } from "./fixtures.ts";

type OutboxRepositories = Pick<Repositories, "notifications">;

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const T0 = 1_791_987_120_000;
const MIN = 60_000;
const at = (minutes: number) => instant(T0 + minutes * MIN);

const notice = (key: string, extra: Partial<OutboxNotice> = {}): OutboxNotice =>
  outboxNoticeFixture({ dedupeKey: key, notBefore: at(0), createdAt: at(0), ...extra });

/**
 * `NotificationOutboxRepository` contract (ADR-0017), adapter-neutral, driven through the unit of
 * work. The factory must return an EMPTY store. The outbox has no foreign keys, so nothing needs
 * seeding. Rows are observed through `claimDue` (a far-future claim returns every live row) and
 * `purgeFinished` (how many final rows there are), the only reads the port has.
 */
export function describeNotificationOutboxContract(
  name: string,
  factory: () => Promise<ContractSubject<OutboxRepositories>>,
): void {
  describe(`NotificationOutboxRepository contract (${name})`, () => {
    async function subject() {
      const { uow } = await factory();
      const tx = <T>(run: (repos: OutboxRepositories) => Promise<T>) =>
        uow
          .transaction(async (repos) => ok(await run(repos)))
          .then((r) => (r.ok ? r.value : (undefined as T)));
      return {
        uow,
        tx,
        enqueue: (...rows: OutboxNotice[]) =>
          tx(({ notifications }) => notifications.enqueue(rows)),
        claim: (now: number, lease: number, limit = 50) =>
          tx(({ notifications }) => notifications.claimDue(at(now), at(lease), limit)),
        finish: (key: string, attempts: number, state: "sent" | "dropped" | "failed", when = 1) =>
          tx(({ notifications }) =>
            notifications.finish(key, attempts, state, "delivered", at(when)),
          ),
        reschedule: (key: string, attempts: number, notBefore: number) =>
          tx(({ notifications }) =>
            notifications.reschedule(key, attempts, {
              notBefore: at(notBefore),
              expiresAt: at(notBefore + 600),
              rolloversLeft: 0,
              attempts: attempts - 1,
            }),
          ),
        purge: (before: number, limit = 200) =>
          tx(({ notifications }) => notifications.purgeFinished(at(before), limit)),
      };
    }

    it("enqueue adds new rows as pending with no attempts, and reports how many", async () => {
      const s = await subject();
      expect(await s.enqueue(notice("a"), notice("b"))).toBe(2);
      const claimed = await s.claim(10, 15);
      expect(claimed.map((n) => [n.dedupeKey, n.state, n.attempts])).toEqual([
        ["a", "sending", 1],
        ["b", "sending", 1],
      ]);
    });

    it("enqueue ignores a dedupe key that already exists, keeping the first row (REQ-O2)", async () => {
      const s = await subject();
      await s.enqueue(notice("a", { notBefore: at(5) }));
      expect(await s.enqueue(notice("a", { notBefore: at(1) }), notice("b"))).toBe(1);
      const claimed = await s.claim(10, 15);
      expect(claimed.find((n) => n.dedupeKey === "a")?.notBefore).toBe(at(5));
      expect(claimed).toHaveLength(2);
    });

    it("enqueue of a key already enqueued in the same call is a no-op too", async () => {
      const s = await subject();
      expect(await s.enqueue(notice("a"), notice("a"))).toBe(1);
    });

    it("leaves nothing behind when the transaction rolls back (REQ-O1)", async () => {
      const s = await subject();
      await s.uow.transaction(async ({ notifications }) => {
        await notifications.enqueue([notice("a")]);
        return err("rollback");
      });
      expect(await s.claim(10, 15)).toEqual([]);
    });

    it("round-trips every field of a notice, params included", async () => {
      const s = await subject();
      const row = notice("pauseEndsTomorrow:p1:2026-10-20:m1", {
        kind: "pauseEndsTomorrow",
        params: {
          seasonId: seasonId(uuid(0xe1)),
          pauseRequestId: pauseRequestId(uuid(0xf1)),
          lastDate: localDate("2026-10-20"),
        },
        seasonId: null,
        recipientMemberId: memberId(uuid(0xa2)),
        expiresAt: at(600),
        rolloversLeft: 1,
      } as Partial<OutboxNotice>);
      await s.enqueue(row);
      const [claimed] = await s.claim(10, 15);
      expect(claimed).toEqual({ ...row, state: "sending", attempts: 1, leaseUntil: at(15) });
    });

    it("claims only due rows, oldest notBefore first, up to the limit", async () => {
      const s = await subject();
      await s.enqueue(
        notice("late", { notBefore: at(3) }),
        notice("early", { notBefore: at(1) }),
        notice("future", { notBefore: at(30) }),
        notice("middle", { notBefore: at(2) }),
      );
      expect((await s.claim(10, 15, 2)).map((n) => n.dedupeKey)).toEqual(["early", "middle"]);
      expect((await s.claim(10, 15, 5)).map((n) => n.dedupeKey)).toEqual(["late"]);
      expect(await s.claim(10, 15)).toEqual([]);
    });

    it("re-claims a sending row only once its lease has passed, counting another attempt", async () => {
      const s = await subject();
      await s.enqueue(notice("a"));
      await s.claim(1, 6);
      expect(await s.claim(5, 10)).toEqual([]);
      const [again] = await s.claim(6, 11);
      expect(again).toMatchObject({
        dedupeKey: "a",
        state: "sending",
        attempts: 2,
        leaseUntil: at(11),
      });
    });

    it("finish ends a claimed row when the fence matches, and never again", async () => {
      const s = await subject();
      await s.enqueue(notice("a"));
      await s.claim(1, 6);
      expect(await s.finish("a", 2, "sent")).toBe(false);
      expect(await s.finish("a", 1, "sent")).toBe(true);
      expect(await s.finish("a", 1, "dropped")).toBe(false);
      expect(await s.claim(100, 105)).toEqual([]);
    });

    it("finish loses against a newer claim of the same row (an expired lease)", async () => {
      const s = await subject();
      await s.enqueue(notice("a"));
      await s.claim(1, 6);
      await s.claim(7, 12);
      expect(await s.finish("a", 1, "sent")).toBe(false);
      expect(await s.finish("a", 2, "sent")).toBe(true);
    });

    it("finish of a pending or unknown row changes nothing", async () => {
      const s = await subject();
      await s.enqueue(notice("a"));
      expect(await s.finish("a", 0, "sent")).toBe(false);
      expect(await s.finish("missing", 1, "sent")).toBe(false);
      expect(await s.claim(10, 15)).toHaveLength(1);
    });

    it("reschedule puts a claimed row back to pending with its new window and attempts", async () => {
      const s = await subject();
      await s.enqueue(notice("a"));
      await s.claim(1, 6);
      expect(await s.reschedule("a", 2, 50)).toBe(false);
      expect(await s.reschedule("a", 1, 50)).toBe(true);
      expect(await s.claim(49, 55)).toEqual([]);
      const [back] = await s.claim(50, 55);
      expect(back).toMatchObject({
        state: "sending",
        attempts: 1,
        notBefore: at(50),
        expiresAt: at(650),
        rolloversLeft: 0,
      });
    });

    it("purgeFinished deletes only final rows that finished before the cutoff, up to the limit", async () => {
      const s = await subject();
      await s.enqueue(
        notice("sent"),
        notice("dropped"),
        notice("failed"),
        notice("recent"),
        notice("live"),
      );
      await s.claim(1, 6);
      await s.finish("sent", 1, "sent", 10);
      await s.finish("dropped", 1, "dropped", 11);
      await s.finish("failed", 1, "failed", 12);
      await s.finish("recent", 1, "sent", 100);
      expect(await s.purge(50, 2)).toBe(2);
      expect(await s.purge(50)).toBe(1);
      expect(await s.purge(50)).toBe(0);
      expect(await s.purge(1000)).toBe(1);
      // The live row is still claimable once its lease ends.
      expect((await s.claim(2000, 2005)).map((n) => n.dedupeKey)).toEqual(["live"]);
    });

    it("deleteAddressedTo deletes every row of the user or of those members, in every state, and no one else's", async () => {
      const s = await subject();
      const ANDREA_USER = userId(uuid(0xb1));
      const PEER_USER = userId(uuid(0xb2));
      const PEER_MEMBER = memberId(uuid(0xa2));
      await s.enqueue(
        notice("pending", { recipientUserId: ANDREA_USER, notBefore: at(500) }),
        notice("sending", { recipientUserId: ANDREA_USER }),
        notice("sent", { recipientUserId: ANDREA_USER }),
        notice("by-member", {
          recipientUserId: PEER_USER,
          recipientMemberId: memberId(uuid(0xa5)),
          notBefore: at(500),
        }),
        notice("peer", {
          recipientUserId: PEER_USER,
          recipientMemberId: PEER_MEMBER,
          notBefore: at(500),
        }),
      );
      await s.claim(1, 6);
      await s.finish("sent", 1, "sent", 10);
      await s.tx(({ notifications }) =>
        notifications.deleteAddressedTo(ANDREA_USER, [memberId(uuid(0xa5))]),
      );
      await s.tx(({ notifications }) =>
        notifications.deleteAddressedTo(ANDREA_USER, [memberId(uuid(0xa5))]),
      );
      expect((await s.claim(1000, 1005)).map((n) => n.dedupeKey)).toEqual(["peer"]);
      expect(await s.purge(2000)).toBe(0);
    });

    it("deleteAddressedTo with no member ids still deletes the user's rows", async () => {
      const s = await subject();
      await s.enqueue(
        notice("mine", { recipientUserId: userId(uuid(0xb1)) }),
        notice("peer", { recipientUserId: userId(uuid(0xb2)) }),
      );
      await s.tx(({ notifications }) => notifications.deleteAddressedTo(userId(uuid(0xb1)), []));
      expect((await s.claim(10, 15)).map((n) => n.dedupeKey)).toEqual(["peer"]);
    });

    it("deleteByCircles deletes every row of those circles and keeps the others", async () => {
      const s = await subject();
      const GONE = circleId(uuid(0xc1));
      const KEPT = circleId(uuid(0xc2));
      await s.enqueue(
        notice("gone-1", { circleId: GONE }),
        notice("gone-2", { circleId: GONE, seasonId: null }),
        notice("kept", { circleId: KEPT }),
      );
      await s.claim(1, 6, 1);
      await s.tx(({ notifications }) => notifications.deleteByCircles([]));
      expect(
        await s.tx(({ notifications }) => notifications.claimDue(at(100), at(105), 9)),
      ).toHaveLength(3);
      await s.tx(({ notifications }) => notifications.deleteByCircles([GONE]));
      await s.tx(({ notifications }) => notifications.deleteByCircles([GONE]));
      expect((await s.claim(1000, 1005)).map((n) => n.dedupeKey)).toEqual(["kept"]);
    });

    it("a rolled-back deletion leaves the rows", async () => {
      const s = await subject();
      await s.enqueue(notice("mine"));
      await s.uow.transaction(async ({ notifications }) => {
        await notifications.deleteAddressedTo(userId(uuid(0xb1)), []);
        await notifications.deleteByCircles([circleId(uuid(0xc1))]);
        return err("rollback");
      });
      expect((await s.claim(10, 15)).map((n) => n.dedupeKey)).toEqual(["mine"]);
    });
  });
}
