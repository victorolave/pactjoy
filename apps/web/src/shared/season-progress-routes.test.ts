import { describe, expect, it } from "vitest";
import {
  progressApiPaths,
  progressRoutePatterns,
  progressRoutes,
} from "./season-progress-routes.ts";

describe("season progress routes", () => {
  it("builds the four screen paths under /season, with a 0-based week index", () => {
    expect(progressRoutes.overview).toBe("/season");
    expect(progressRoutes.member("s1", "m1")).toBe("/season/s1/members/m1");
    expect(progressRoutes.commitment("s1", "c1")).toBe("/season/s1/commitments/c1");
    expect(progressRoutes.week("s1", 0)).toBe("/season/s1/weeks/0/summary");
  });

  it("builds the four API paths reserved for the progress reads", () => {
    expect(progressApiPaths.season("s1")).toBe("/seasons/s1/progress");
    expect(progressApiPaths.member("s1", "m1")).toBe("/seasons/s1/members/m1/progress");
    expect(progressApiPaths.commitment("s1", "c1")).toBe("/seasons/s1/commitments/c1/progress");
    expect(progressApiPaths.week("s1", 3)).toBe("/seasons/s1/weeks/3/summary");
  });

  it("encodes ids so a crafted id cannot change the path", () => {
    expect(progressRoutes.member("s/1", "m?1")).toBe("/season/s%2F1/members/m%3F1");
    expect(progressApiPaths.commitment("s1", "../c")).toBe(
      "/seasons/s1/commitments/..%2Fc/progress",
    );
  });

  it("rejects a week index that is negative or not an integer", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => progressRoutes.week("s1", bad)).toThrow(RangeError);
      expect(() => progressApiPaths.week("s1", bad)).toThrow(RangeError);
    }
  });

  it("exposes router patterns relative to the app root", () => {
    expect(progressRoutePatterns).toEqual({
      member: "season/:seasonId/members/:memberId",
      commitment: "season/:seasonId/commitments/:commitmentId",
      week: "season/:seasonId/weeks/:weekIndex/summary",
    });
  });
});
