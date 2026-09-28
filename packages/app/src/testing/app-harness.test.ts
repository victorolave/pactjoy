import { describe, expect, it } from "vitest";
import { instant } from "../time/instant.ts";
import { createTestApp } from "./app-harness.ts";

describe("createTestApp", () => {
  it("composes a Clock, IdGenerator and RandomSource that are all deterministic by default", () => {
    const app = createTestApp();

    const firstRun = {
      now: app.clock.now(),
      id: app.ids.next(),
      random: app.random.int(1000),
    };

    const secondApp = createTestApp();
    const secondRun = {
      now: secondApp.clock.now(),
      id: secondApp.ids.next(),
      random: secondApp.random.int(1000),
    };

    expect(firstRun).toEqual(secondRun);
  });

  it("accepts overrides for the fixed instant, id prefix and random seed", () => {
    const app = createTestApp({ now: instant(1234), idPrefix: "circle", randomSeed: 9 });

    expect(app.clock.now()).toBe(1234);
    expect(app.ids.next()).toBe("circle-1");
    expect(app.ids.next()).toBe("circle-2");
  });
});
