import { describe, expect, it } from "vitest";
import { circleId, userId } from "../shared/ids.ts";
import { circleFixture, memberFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { memberId } from "./circle.ts";
import { eraseInviteOf, eraseMember } from "./erase-member.ts";
import { inviteCode } from "./invite-code.ts";

const NOW = instant(1_800_000_000_000);
const ROTATED = userId("unlinked-random-uuid");

describe("invite of an erased member", () => {
  const ANDREA = memberFixture({ id: memberId("m-andrea"), userId: userId("u-andrea") });
  const VICTOR = memberFixture({ id: memberId("m-victor"), userId: userId("u-victor") });
  const invite = (createdBy: typeof ANDREA.id) => ({
    code: inviteCode("ERASE1"),
    createdAt: NOW,
    expiresAt: instant(NOW + 1000),
    createdBy,
  });
  const circle = (createdBy: typeof ANDREA.id | null) =>
    circleFixture({
      id: circleId("c-1"),
      members: [ANDREA, VICTOR],
      invite: createdBy ? invite(createdBy) : null,
    });

  it("is dropped when an erased member created it", () => {
    const before = circle(ANDREA.id);
    expect(eraseInviteOf(before, [ANDREA.id])).toEqual({ ...before, invite: null });
    expect(before.invite?.createdBy).toBe(ANDREA.id);
  });

  it("is kept when someone else created it, and a circle with no invite is returned as it is", () => {
    const peers = circle(VICTOR.id);
    expect(eraseInviteOf(peers, [ANDREA.id])).toBe(peers);
    const none = circle(null);
    expect(eraseInviteOf(none, [ANDREA.id, VICTOR.id])).toBe(none);
  });

  it("is dropped when any of several erased members created it", () => {
    const before = circle(VICTOR.id);
    expect(eraseInviteOf(before, [ANDREA.id, VICTOR.id]).invite).toBeNull();
  });
});

describe("membership tombstone", () => {
  it("retains the scoring member id but drops the identity and name", () => {
    const before = memberFixture({
      id: memberId("scoring-member-id"),
      userId: userId("original-auth-uuid"),
      displayName: "Andrea",
    });
    const after = eraseMember(before, NOW, ROTATED);
    expect(after).toEqual({
      ...before,
      userId: ROTATED,
      displayName: "",
      status: "left",
      leftAt: NOW,
      erasedAt: NOW,
    });
    expect(before.displayName).toBe("Andrea");
  });

  it("keeps the earlier leave instant when erasing a past membership", () => {
    const leftAt = instant(NOW - 10_000);
    const before = memberFixture({
      id: memberId("past-member-id"),
      userId: userId("original-auth-uuid"),
      status: "left",
      leftAt,
    });
    expect(eraseMember(before, NOW, ROTATED)).toEqual({
      ...before,
      userId: ROTATED,
      displayName: "",
      erasedAt: NOW,
    });
  });
});
