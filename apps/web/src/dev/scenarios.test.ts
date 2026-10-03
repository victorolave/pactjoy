import { describe, expect, it } from "vitest";
import { SCENARIOS, scenarioById } from "./scenarios.ts";

const WANTED = [
  "noCircle",
  "noSeason",
  "pactOpen",
  "notStarted",
  "mixed",
  "nothingToday",
  "allDone",
  "allLoggedWithMiss",
  "endedInGrace",
  "weekRowsOnly",
  "loading",
  "error",
  "offline",
];

describe("the Today scenario gallery", () => {
  it("has every scenario the owner asked to see, with unique ids", () => {
    const ids = SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(WANTED));
  });

  it("finds a scenario by id, and not an unknown one", () => {
    expect(scenarioById("mixed")?.id).toBe("mixed");
    expect(scenarioById("nope")).toBeUndefined();
  });
});
