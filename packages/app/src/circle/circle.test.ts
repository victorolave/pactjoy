import { describe, expect, it } from "vitest";
import { circleId, userId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { activeMembers, buildCircle, findActiveMember, memberId } from "./circle.ts";

const NOW = instant(1_700_000_000_000);

describe("buildCircle", () => {
  it("CM-1: creates a circle with the creator as its sole, active first member", () => {
    const result = buildCircle({
      id: circleId("circle-1"),
      name: "Río Runners",
      creatorId: memberId("member-1"),
      creatorUserId: userId("user-andrea"),
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Río Runners");
    expect(result.value.members).toEqual([
      {
        id: "member-1",
        userId: "user-andrea",
        status: "active",
        joinedAt: NOW,
        leftAt: null,
      },
    ]);
    expect(result.value.invite).toBeNull();
    expect(result.value.version).toBe(0);
  });

  it("CM-2: rejects an empty (or whitespace-only) name", () => {
    const result = buildCircle({
      id: circleId("circle-1"),
      name: "   ",
      creatorId: memberId("member-1"),
      creatorUserId: userId("user-andrea"),
      now: NOW,
    });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidName" } });
  });
});

describe("activeMembers / findActiveMember", () => {
  it("filters out members who have left and finds an active member by userId", () => {
    const circle = buildCircle({
      id: circleId("circle-1"),
      name: "Río Runners",
      creatorId: memberId("member-1"),
      creatorUserId: userId("user-andrea"),
      now: NOW,
    });
    if (!circle.ok) throw new Error("fixture setup failed");

    const withLeftMember = {
      ...circle.value,
      members: [
        ...circle.value.members,
        {
          id: memberId("member-2"),
          userId: userId("user-victor"),
          status: "left" as const,
          joinedAt: NOW,
          leftAt: NOW,
        },
      ],
    };

    expect(activeMembers(withLeftMember)).toHaveLength(1);
    expect(findActiveMember(withLeftMember, userId("user-andrea"))?.id).toBe("member-1");
    expect(findActiveMember(withLeftMember, userId("user-victor"))).toBeUndefined();
  });
});
