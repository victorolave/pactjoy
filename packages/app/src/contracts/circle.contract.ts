import { describe, expect, it } from "vitest";
import type { Circle, Member } from "../circle/circle.ts";
import { memberId } from "../circle/circle.ts";
import { inviteCode } from "../circle/invite-code.ts";
import type { Repositories } from "../ports/repositories.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { circleId, userId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { circleFixture, memberFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { CIRCLE, type ContractSubject } from "./fixtures.ts";

type CircleRepositories = Pick<Repositories, "circles">;
type Uow = ContractSubject<CircleRepositories>["uow"];

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const member = (n: number, options: Partial<Member> = {}): Member =>
  memberFixture({ id: memberId(uuid(0x100 + n)), userId: userId(uuid(0x200 + n)), ...options });
const invite = (code: string, createdBy: Member) => ({
  code: inviteCode(code),
  createdAt: instant(1_700_000_000_000),
  expiresAt: instant(1_700_000_600_000),
  createdBy: createdBy.id,
});

const OTHER_CIRCLE_ID = circleId(uuid(0xc2));

/** Saves in its own transaction; a lost race surfaces as the transaction rejecting. */
const saveCircle = (uow: Uow, circle: Circle, expected: number | null) =>
  uow.transaction(async ({ circles }) => {
    await circles.save(circle, expected);
    return ok(undefined);
  });

const read = <T>(uow: Uow, work: (circles: CircleRepositories["circles"]) => Promise<T>) =>
  uow.read(({ circles }) => work(circles));

/**
 * `CircleRepository` contract (CP-S1..S6, S9..S11, S13, S14, S16..S18),
 * adapter-neutral: driven only through `uow.transaction` / `uow.read`. The
 * factory must return an EMPTY store.
 */
export function describeCircleRepositoryContract(
  name: string,
  factory: () => Promise<ContractSubject<CircleRepositories>>,
): void {
  describe(`CircleRepository contract (${name})`, () => {
    const getCircle = (uow: Uow) => read(uow, (c) => c.get(CIRCLE.id));

    it("CP-S1: get returns null for an unknown id", async () => {
      const { uow } = await factory();
      expect(await getCircle(uow)).toBeNull();
    });

    it("CP-S2: round-trips three members and an invite", async () => {
      const { uow } = await factory();
      const members = [member(1), member(2), member(3, { status: "left", leftAt: instant(5) })];
      const circle = circleFixture({
        id: CIRCLE.id,
        members,
        invite: invite("ABC123", members[0] as Member),
        name: "Ñandú 📚",
      });
      await saveCircle(uow, circle, null);
      expect(await getCircle(uow)).toEqual(circle);
    });

    it("CP-S3/S4: round-trips a null invite, archivedAt and a left member's leftAt", async () => {
      const { uow } = await factory();
      const circle = circleFixture({
        id: CIRCLE.id,
        members: [member(1), member(2, { status: "left", leftAt: instant(1_700_000_123_456) })],
        archivedAt: instant(1_700_000_999_999),
      });
      await saveCircle(uow, circle, null);
      expect(await getCircle(uow)).toEqual(circle);
    });

    it("CP-S5: members keep the saved order, ties in joinedAt included, on every read", async () => {
      const { uow } = await factory();
      const members = [member(3), member(1), member(2)];
      await saveCircle(uow, circleFixture({ id: CIRCLE.id, members }), null);
      for (let i = 0; i < 20; i++) {
        expect((await getCircle(uow))?.members.map((m) => m.id)).toEqual(members.map((m) => m.id));
      }
    });

    it("CP-S6: appending a member keeps the earlier members in place", async () => {
      const { uow } = await factory();
      const first = circleFixture({ id: CIRCLE.id, members: [member(2), member(1)] });
      await saveCircle(uow, first, null);
      const next = { ...first, members: [...first.members, member(3)], version: 1 };
      await saveCircle(uow, next, 0);
      expect((await getCircle(uow))?.members.map((m) => m.id)).toEqual(
        next.members.map((m) => m.id),
      );
    });

    it("CP-S9: save(null) over an existing id conflicts", async () => {
      const { uow } = await factory();
      await saveCircle(uow, CIRCLE, null);
      await expect(saveCircle(uow, { ...CIRCLE, name: "other" }, null)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      expect(await getCircle(uow)).toEqual(CIRCLE);
    });

    it("CP-S10: save succeeds at the stored version and conflicts when stale or missing", async () => {
      const { uow } = await factory();
      await saveCircle(uow, CIRCLE, null);
      const v1 = { ...CIRCLE, name: "v1", version: 1 };
      await saveCircle(uow, v1, 0);
      await expect(saveCircle(uow, { ...v1, name: "late" }, 0)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      await expect(
        saveCircle(uow, { ...CIRCLE, id: OTHER_CIRCLE_ID, version: 1 }, 0),
      ).rejects.toBeInstanceOf(ConcurrencyConflict);
      expect(await getCircle(uow)).toEqual(v1);
    });

    it("CP-S11: an update leaves exactly the new member set", async () => {
      const { uow } = await factory();
      await saveCircle(
        uow,
        circleFixture({ id: CIRCLE.id, members: [member(1), member(2)] }),
        null,
      );
      const next = circleFixture({ id: CIRCLE.id, members: [member(2), member(3)], version: 1 });
      await saveCircle(uow, next, 0);
      expect(await getCircle(uow)).toEqual(next);
    });

    it("CP-S13: findByInviteCode finds the owner, never an unknown code or an invite-less circle", async () => {
      const { uow } = await factory();
      const m = member(1);
      const withInvite = circleFixture({
        id: CIRCLE.id,
        members: [m],
        invite: invite("ABC123", m),
      });
      await saveCircle(uow, withInvite, null);
      await saveCircle(uow, circleFixture({ id: OTHER_CIRCLE_ID, members: [member(2)] }), null);
      expect(await read(uow, (c) => c.findByInviteCode("ABC123"))).toEqual(withInvite);
      expect(await read(uow, (c) => c.findByInviteCode("ZZZ999"))).toBeNull();
    });

    it("CP-S14: a regenerated invite replaces the old code", async () => {
      const { uow } = await factory();
      const m = member(1);
      const v0 = circleFixture({ id: CIRCLE.id, members: [m], invite: invite("OLD111", m) });
      await saveCircle(uow, v0, null);
      const v1 = { ...v0, invite: invite("NEW222", m), version: 1 };
      await saveCircle(uow, v1, 0);
      expect(await read(uow, (c) => c.findByInviteCode("OLD111"))).toBeNull();
      expect(await read(uow, (c) => c.findByInviteCode("NEW222"))).toEqual(v1);
    });

    it("CP-S16: a code is free again once its circle drops the invite", async () => {
      const { uow } = await factory();
      const a = member(1);
      const withInvite = circleFixture({
        id: CIRCLE.id,
        members: [a],
        invite: invite("ABC123", a),
      });
      await saveCircle(uow, withInvite, null);
      await saveCircle(uow, { ...withInvite, invite: null, version: 1 }, 0);
      const b = member(2);
      const other = circleFixture({
        id: OTHER_CIRCLE_ID,
        members: [b],
        invite: invite("ABC123", b),
      });
      await saveCircle(uow, other, null);
      expect(await read(uow, (c) => c.findByInviteCode("ABC123"))).toEqual(other);
    });

    it("CP-S17/S18: findActiveByUser finds an active member, not a left or unknown user", async () => {
      const { uow } = await factory();
      const active = member(1);
      const left = member(2, { status: "left", leftAt: instant(9) });
      const circle = circleFixture({ id: CIRCLE.id, members: [active, left] });
      await saveCircle(uow, circle, null);
      expect(await read(uow, (c) => c.findActiveByUser(active.userId))).toEqual(circle);
      expect(await read(uow, (c) => c.findActiveByUser(left.userId))).toBeNull();
      expect(await read(uow, (c) => c.findActiveByUser(userId(uuid(0x2ff))))).toBeNull();
    });
  });
}
