import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { progressKey, reviewKey, stageKey, todayKey } from "../../shared/query-keys.ts";
import { invalidateReviewState } from "./queries.ts";

describe("invalidateReviewState", () => {
  it("marks Today, every review read and the progress reads (stage included) stale after a save or a skip", async () => {
    const client = new QueryClient();
    const keys = [
      todayKey,
      reviewKey("s1", 2),
      stageKey("s1", "c1"),
      [...progressKey, "season", "s1"],
    ];
    for (const key of keys) client.setQueryData(key, { value: 1 });
    await invalidateReviewState(client);
    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
  });
});
