import { describe, expect, it } from "vitest";
import { userId } from "../shared/ids.ts";
import { memberFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import { memberId } from "./circle.ts";
import { eraseMember } from "./erase-member.ts";

const NOW = instant(1_800_000_000_000);
const ROTATED = userId("unlinked-random-uuid");

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
