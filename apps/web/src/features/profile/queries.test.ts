import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { profileSummaryKey, progressKey, seasonHistoryKey } from "../../shared/query-keys.ts";
import { profileSummaryFixture } from "../../testing/fixtures/profile.ts";

it("a progress-root invalidation (entry, pause, review, closure, pact change) refreshes the Perfil summary", async () => {
  const client = new QueryClient();
  client.setQueryData(profileSummaryKey, profileSummaryFixture());
  client.setQueryData(seasonHistoryKey, { seasons: [] });
  await client.invalidateQueries({ queryKey: progressKey, refetchType: "none" });
  expect(client.getQueryState(profileSummaryKey)?.isInvalidated).toBe(true);
  // The closed-season history lives under its own root and is not touched by a progress refresh.
  expect(client.getQueryState(seasonHistoryKey)?.isInvalidated).toBe(false);
});
