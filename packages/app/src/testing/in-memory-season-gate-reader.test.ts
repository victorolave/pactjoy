import { describe, expect, it } from "vitest";
import { circleId } from "../shared/ids.ts";
import { createInMemorySeasonGateReader } from "./in-memory-season-gate-reader.ts";

describe("createInMemorySeasonGateReader", () => {
  it("defaults an unconfigured circle to noSeason", async () => {
    const reader = createInMemorySeasonGateReader();

    expect(await reader.statusForCircle(circleId("circle-1"))).toBe("noSeason");
  });

  it("setStatus() overrides the status returned for a specific circle", async () => {
    const reader = createInMemorySeasonGateReader();

    reader.setStatus(circleId("circle-1"), "active");

    expect(await reader.statusForCircle(circleId("circle-1"))).toBe("active");
    expect(await reader.statusForCircle(circleId("circle-2"))).toBe("noSeason");
  });
});
