import { describe, expect, it } from "vitest";
import { commitmentCount, pactFlow, viewerMemberId } from "./pact-flow.ts";

describe("pact flow (WF-R6–R8)", () => {
  it.each([
    [0, "0 compromisos"],
    [1, "1 compromiso"],
    [4, "4 compromisos"],
  ])("pluralizes %i commitments as %s", (count, expected) => {
    expect(commitmentCount(count)).toBe(expected);
  });
  it("shows review until this viewer approves, then waiting", () => {
    const season = {
      status: "pactOpen" as const,
      approvals: [{ memberId: "andrea", approvedAt: "x" }],
    };
    expect(pactFlow(season, "victor")).toBe("review");
    expect(pactFlow(season, "andrea")).toBe("waiting");
    expect(pactFlow({ ...season, approvals: [] }, "andrea")).toBe("review");
  });
  it("celebrates an active season once, including a solo pact, but never an ended one", () => {
    expect(pactFlow({ status: "active", approvals: [] }, "andrea")).toBe("closed");
    expect(pactFlow({ status: "active", approvals: [] }, "andrea", true)).toBe("today");
    expect(pactFlow({ status: "closed", approvals: [] }, "andrea")).toBe("today");
  });
  it("matches approvals by the circle member id, never the auth user id", () => {
    const myCircle = {
      circle: {
        id: "c1",
        name: "Casa",
        invite: null,
        members: [
          { id: "m-victor", displayName: "Victor", joinedAt: "x", isYou: false },
          { id: "m-andrea", displayName: "Andrea", joinedAt: "x", isYou: true },
        ],
      },
    };
    const season = {
      status: "pactOpen" as const,
      approvals: [{ memberId: "m-andrea", approvedAt: "x" }],
    };
    expect(viewerMemberId(myCircle)).toBe("m-andrea");
    expect(pactFlow(season, viewerMemberId(myCircle) ?? "")).toBe("waiting");
    expect(pactFlow(season, "user-andrea")).toBe("review");
    expect(viewerMemberId({ circle: null })).toBeNull();
  });
});
