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
  "loggedWithPhoto",
  "allLoggedWithMiss",
  "endedInGrace",
  "weekRowsOnly",
  "pendingYesterday",
  "pendingYesterdayNothingToday",
  "pausePending",
  "pauseApproved",
  "pauseEndsTomorrow",
  "yesterdayMixed",
  "reviewPending",
  "reviewBaselineOffer",
  "reviewClosing",
  "closeResultsSoon",
  "closeDecide",
  "closeWaiting",
  "closeStale",
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

  it("has a logged entry with a photo, so the edit sheet can be seen with one", () => {
    const view = scenarioById("loggedWithPhoto")?.today();
    const rows = view?.state === "active" ? view.rows : [];
    const photos = rows.flatMap((row) => row.entries.map((entry) => entry.photo));
    expect(photos.filter((photo) => photo !== null)).toHaveLength(1);
  });
});
