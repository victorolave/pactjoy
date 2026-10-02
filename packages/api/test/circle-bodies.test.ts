import { describe, expect, it } from "vitest";
import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";

describe("circle body helpers", () => {
  it("createCircleBody builds the POST /circles body from a circle name", () => {
    expect(createCircleBody("Crew")).toEqual({ name: "Crew" });
  });

  it("joinCircleBody builds the POST /circles/join body from an invite code", () => {
    expect(joinCircleBody("ABCDEF")).toEqual({ inviteCode: "ABCDEF" });
  });
});
