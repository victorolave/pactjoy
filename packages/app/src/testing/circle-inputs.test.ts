import { describe, expect, it } from "vitest";
import { createCircleInput, joinCircleInput } from "./circle-inputs.ts";

describe("circle input helpers", () => {
  it("createCircleInput builds the createCircle input, defaulting the display name to Creator", () => {
    expect(createCircleInput("Río Runners")).toEqual({
      name: "Río Runners",
      displayName: "Creator",
    });
    expect(createCircleInput("Río Runners", "Ana").displayName).toBe("Ana");
  });

  it("joinCircleInput builds the joinCircle input, defaulting the display name to Joiner", () => {
    expect(joinCircleInput("AB23CD")).toEqual({ inviteCode: "AB23CD", displayName: "Joiner" });
    expect(joinCircleInput("AB23CD", "Vic").displayName).toBe("Vic");
  });
});
