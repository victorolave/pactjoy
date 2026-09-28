import { describe, expect, it } from "vitest";
import { createSystemClock } from "./system-clock.ts";

describe("createSystemClock", () => {
  it("returns the real wall-clock time as an Instant", () => {
    const clock = createSystemClock();
    const before = Date.now();

    const now = clock.now();

    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it("never goes backwards across two consecutive calls", () => {
    const clock = createSystemClock();

    const first = clock.now();
    const second = clock.now();

    expect(second).toBeGreaterThanOrEqual(first);
  });
});
