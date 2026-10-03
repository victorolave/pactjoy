import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemClock } from "./system-clock.ts";

describe("SystemClock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads the current time in milliseconds", () => {
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    expect(new SystemClock().nowMs()).toBe(Date.parse("2026-10-02T12:00:00Z"));
    vi.advanceTimersByTime(1500);
    expect(new SystemClock().nowMs()).toBe(Date.parse("2026-10-02T12:00:01.500Z"));
  });
});
