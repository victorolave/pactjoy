import { describe, expect, it } from "vitest";
import { pactFlow } from "./pact-flow.ts";

describe("pact flow (WF-R6–R8)", () => {
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
});
