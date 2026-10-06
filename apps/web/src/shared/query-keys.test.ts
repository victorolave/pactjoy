import { expect, it } from "vitest";
import { habitsKey, scoringPreviewKey, seasonKey } from "./query-keys.ts";

it("isolates habit, season and preview caches by their identity", () => {
  expect(habitsKey).toEqual(["habits"]);
  expect(seasonKey("s1")).toEqual(["season", "s1"]);
  expect(seasonKey("s2")).not.toEqual(seasonKey("s1"));
  expect(scoringPreviewKey("draft-1")).toEqual(["scoringPreview", "draft-1"]);
  expect(scoringPreviewKey("draft-2")).not.toEqual(scoringPreviewKey("draft-1"));
});
