import { describe, expect, it } from "vitest";
import type { PactJoyApi } from "../ports/pactjoy-api.ts";
import { activeTodayFixture } from "../testing/fixtures/today.ts";
import { isServerToday, todayQuery } from "./fetch-today.ts";
import { tick } from "./ordering.ts";
import { lastTodayFetchStart } from "./today-fetch.ts";

const api = { getToday: async () => activeTodayFixture() } as unknown as PactJoyApi;

describe("todayQuery", () => {
  it("marks the answer as the server's AND notes when its fetch started (celebration and outbox)", async () => {
    const before = tick();
    const view = await todayQuery(api).queryFn({ signal: new AbortController().signal });
    expect(isServerToday(view)).toBe(true);
    expect(lastTodayFetchStart()).toBeGreaterThan(before);
  });

  it("keeps structural sharing off, so a restored equal view never stands for the server's", () => {
    expect(todayQuery(api).structuralSharing).toBe(false);
  });
});
