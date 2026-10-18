import { expect, it } from "vitest";
import {
  carryOverKey,
  commitmentProgressKey,
  feedKey,
  habitsKey,
  memberProgressKey,
  profileSummaryKey,
  progressKey,
  reviewKey,
  reviewsKey,
  scoringPreviewKey,
  seasonCloseKey,
  seasonHistoryKey,
  seasonKey,
  seasonProgressKey,
  seasonResultsKey,
  socialKey,
  stageKey,
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

it("nests every review read under one root so a saved review refreshes them all", () => {
  expect(reviewsKey).toEqual(["review"]);
  expect(reviewKey("s1", 2).slice(0, 1)).toEqual(reviewsKey);
  expect(reviewKey("s1", 0)).not.toEqual(reviewKey("s1", 1));
  expect(reviewKey("s2", 1)).not.toEqual(reviewKey("s1", 1));
});

it("keys a commitment's stage under the progress root, so progress invalidation refreshes the badge", () => {
  expect(stageKey("s1", "c1").slice(0, 1)).toEqual(progressKey);
  expect(stageKey("s1", "c2")).not.toEqual(stageKey("s1", "c1"));
  expect(stageKey("s1", "c1")).not.toEqual(commitmentProgressKey("s1", "c1"));
});

it("nests the results, the carry-over and the history under one season-close root, apart from the season reads", () => {
  expect(seasonCloseKey).toEqual(["seasonClose"]);
  const keys = [seasonResultsKey("s1"), carryOverKey("s1"), seasonHistoryKey];
  for (const key of keys) expect(key.slice(0, 1)).toEqual(seasonCloseKey);
  expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(3);
  expect(seasonResultsKey("s2")).not.toEqual(seasonResultsKey("s1"));
  expect(carryOverKey("s2")).not.toEqual(carryOverKey("s1"));
  // A season-wide invalidation must not refresh the owner-only close reads by accident.
  expect(seasonResultsKey("s1").slice(0, 1)).not.toEqual(seasonKey("s1").slice(0, 1));
});

it("keys the Perfil summary under the progress root, so every settled mutation refreshes it", () => {
  expect(profileSummaryKey.slice(0, 1)).toEqual(progressKey);
  for (const other of [stageKey("s1", "c1"), seasonProgressKey("s1"), seasonHistoryKey]) {
    expect(profileSummaryKey).not.toEqual(other);
  }
});

it("keeps the circle feed under its own social root, apart from the progress reads", () => {
  expect(socialKey).toEqual(["social"]);
  expect(feedKey.slice(0, 1)).toEqual(socialKey);
  expect(feedKey).not.toEqual(socialKey);
  expect(feedKey[0]).not.toBe(progressKey[0]);
});
