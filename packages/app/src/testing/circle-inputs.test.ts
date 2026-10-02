import { describe, expect, it } from "vitest";
import { createCircleInput, joinCircleInput } from "./circle-inputs.ts";

describe("circle input helpers", () => {
  it("createCircleInput builds the createCircle input from a circle name", () => {
    expect(createCircleInput("Río Runners")).toEqual({ name: "Río Runners" });
  });

  it("joinCircleInput builds the joinCircle input from an invite code", () => {
    expect(joinCircleInput("AB23CD")).toEqual({ inviteCode: "AB23CD" });
  });
});
