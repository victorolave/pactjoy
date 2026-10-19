import { describe, expect, it } from "vitest";
import { tick } from "./ordering.ts";

describe("tick", () => {
  it("is strictly increasing, even within the same millisecond", () => {
    const a = tick();
    const b = tick();
    const c = tick();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});
