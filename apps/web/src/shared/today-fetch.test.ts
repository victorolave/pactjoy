import { describe, expect, it } from "vitest";
import { activeTodayFixture } from "../testing/fixtures/today.ts";
import { tick } from "./ordering.ts";
import { fetchToday, lastTodayFetchStart } from "./today-fetch.ts";

const api = { getToday: async () => activeTodayFixture() };

describe("fetchToday", () => {
  it("notes the tick the finished fetch started at, so a send made meanwhile is not settled by it", async () => {
    const before = tick();
    await fetchToday(api);
    const start = lastTodayFetchStart();
    expect(start).toBeGreaterThan(before);
    // A send that finished after that fetch started is newer than it.
    expect(tick()).toBeGreaterThan(start ?? 0);
  });

  it("ignores a fetch that was cancelled for a newer one", async () => {
    await fetchToday(api);
    const settled = lastTodayFetchStart();
    const controller = new AbortController();
    controller.abort();
    await fetchToday(api, controller.signal);
    expect(lastTodayFetchStart()).toBe(settled);
  });
});
