import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { circleId, userId } from "../shared/ids.ts";
import { instant } from "../time/instant.ts";
import { circleFixture, memberFixture } from "./builders.ts";

describe("memberFixture", () => {
  it("defaults to an active member joined at a fixed instant, overridable per field", () => {
    const member = memberFixture({ id: memberId("member-1"), userId: userId("user-andrea") });

    expect(member).toEqual({
      id: "member-1",
      userId: "user-andrea",
      status: "active",
      joinedAt: instant(1_700_000_000_000),
      leftAt: null,
    });

    const left = memberFixture({
      id: memberId("member-2"),
      userId: userId("user-victor"),
      status: "left",
      leftAt: instant(1_700_000_100_000),
    });
    expect(left.status).toBe("left");
    expect(left.leftAt).toBe(1_700_000_100_000);
  });
});

describe("circleFixture", () => {
  it("builds a circle from the given members, defaulting name/invite/version", () => {
    const member = memberFixture({ id: memberId("member-1"), userId: userId("user-andrea") });

    const circle = circleFixture({ id: circleId("circle-1"), members: [member] });

    expect(circle.id).toBe("circle-1");
    expect(circle.name).toBe("Test Circle");
    expect(circle.members).toEqual([member]);
    expect(circle.invite).toBeNull();
    expect(circle.version).toBe(0);
  });

  it("accepts up to 6 members, for CM-10's capacity fixture", () => {
    const members = Array.from({ length: 6 }, (_, i) =>
      memberFixture({ id: memberId(`member-${i}`), userId: userId(`user-${i}`) }),
    );

    const circle = circleFixture({ id: circleId("circle-1"), members });

    expect(circle.members).toHaveLength(6);
  });
});
