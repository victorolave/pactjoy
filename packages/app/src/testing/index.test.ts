import { describe, expect, it } from "vitest";

/** Pins the `./testing` subpath's runtime API surface, same convention as `../index.test.ts`. */
const EXPECTED_RUNTIME_EXPORTS = [
  "circleFixture",
  "createFixedClock",
  "createFixedOffsetTimeZone",
  "createInMemoryCircleRepository",
  "createInMemoryEntryRepository",
  "createInMemoryHabitRepository",
  "createInMemoryPauseRequestReader",
  "createInMemorySeasonRepository",
  "createInMemoryUnitOfWork",
  "createSeededRandomSource",
  "createSequentialIdGenerator",
  "createTestApp",
  "habitFixture",
  "memberFixture",
  "seasonFixture",
].sort();

describe("@pactjoy/app testing subpath", () => {
  it("exposes exactly the expected runtime exports", async () => {
    const testing = await import("./index.ts");
    expect(Object.keys(testing).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });
});
