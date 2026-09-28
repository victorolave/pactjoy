import { describe, expect, it } from "vitest";
import { createSequentialIdGenerator } from "../testing/sequential-ids.ts";

describe("createSequentialIdGenerator", () => {
  it("returns increasing ids prefixed with the given prefix", () => {
    const generator = createSequentialIdGenerator("circle");

    expect(generator.next()).toBe("circle-1");
    expect(generator.next()).toBe("circle-2");
    expect(generator.next()).toBe("circle-3");
  });

  it("keeps independent counters for independently created generators", () => {
    const a = createSequentialIdGenerator("a");
    const b = createSequentialIdGenerator("b");

    expect(a.next()).toBe("a-1");
    expect(b.next()).toBe("b-1");
    expect(a.next()).toBe("a-2");
  });
});
