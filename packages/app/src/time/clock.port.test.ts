import { describe, expect, it } from "vitest";
import { createFixedClock } from "../testing/fixed-clock.ts";
import { instant } from "./instant.ts";

describe("createFixedClock", () => {
  it("always returns the Instant it was created with", () => {
    const at = instant(1_700_000_000_000);
    const clock = createFixedClock(at);

    expect(clock.now()).toBe(at);
    expect(clock.now()).toBe(at);
  });

  it("different FixedClocks are independent of each other", () => {
    const first = createFixedClock(instant(1));
    const second = createFixedClock(instant(2));

    expect(first.now()).toBe(1);
    expect(second.now()).toBe(2);
  });
});
