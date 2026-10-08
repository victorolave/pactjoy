import { expect, it } from "vitest";
import {
  commitmentProgressKey,
  habitsKey,
  memberProgressKey,
  progressKey,
  scoringPreviewKey,
  seasonKey,
  seasonProgressKey,
  weekSummaryKey,
} from "./query-keys.ts";

it("isolates habit, season and preview caches by their identity", () => {
  expect(habitsKey).toEqual(["habits"]);
  expect(seasonKey("s1")).toEqual(["season", "s1"]);
  expect(seasonKey("s2")).not.toEqual(seasonKey("s1"));
  expect(scoringPreviewKey("draft-1")).toEqual(["scoringPreview", "draft-1"]);
  expect(scoringPreviewKey("draft-2")).not.toEqual(scoringPreviewKey("draft-1"));
});

it("nests every progress read under one root, keyed by its season, member, commitment and week", () => {
  const keys = [
    seasonProgressKey("s1"),
    memberProgressKey("s1", "m1"),
    commitmentProgressKey("s1", "c1"),
    weekSummaryKey("s1", 0),
  ];
  for (const key of keys) expect(key.slice(0, 1)).toEqual(progressKey);
  expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(4);
  expect(memberProgressKey("s1", "m2")).not.toEqual(memberProgressKey("s1", "m1"));
  expect(weekSummaryKey("s1", 1)).not.toEqual(weekSummaryKey("s1", 0));
  expect(seasonProgressKey("s2")).not.toEqual(seasonProgressKey("s1"));
});
