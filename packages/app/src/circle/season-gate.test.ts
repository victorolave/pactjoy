import { describe, expect, it } from "vitest";
import { canJoinCircle } from "./season-gate.ts";

describe("canJoinCircle", () => {
  it("CM-7/CM-8 (reinterpreted, B1): allows joining when there is no season yet", () => {
    expect(canJoinCircle("noSeason")).toBe(true);
  });

  it("CM-7/CM-8 (reinterpreted, B1): allows joining while the season's pact is still open", () => {
    expect(canJoinCircle("pactOpen")).toBe(true);
  });

  it("B11: allows joining between seasons -- the circle's last season is closed and no new one has started", () => {
    expect(canJoinCircle("closed")).toBe(true);
  });

  it("CM-9 (B11): rejects joining only while a season is active (pact closed, mid-season)", () => {
    expect(canJoinCircle("active")).toBe(false);
  });
});
