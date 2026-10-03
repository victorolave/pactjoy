import { describe, expect, it } from "vitest";

/**
 * Pins the engine's public runtime API surface (type-only exports are
 * erased at runtime and can't appear here — see `index.type-test.ts` for
 * those). Growing this list on purpose is fine; an export slipping in by
 * accident (e.g. re-exporting an internal helper while wiring a new
 * capability) makes this test fail loudly instead of silently widening
 * `packages/app`'s surface area.
 */
const EXPECTED_RUNTIME_EXPORTS = [
  "canRequestPause",
  "compare",
  "displayPercent",
  "displayPoints",
  "displayPointsDecimal",
  "eq",
  "frac",
  "fromInt",
  "graceDeadline",
  "gt",
  "gte",
  "isLimitIdealWithinTolerance",
  "isPositiveReachMinimum",
  "isReachMinimumWithinIdeal",
  "isValidWeightPercent",
  "lt",
  "lte",
  "opportunityPoints",
  "opportunityPointsAt",
  "opportunityValue",
  "parseDecimal",
  "progressAtValue",
  "rankStandings",
  "scoreMember",
  "seasonDay",
  "sumPoints",
  "weekBoundGraceDeadline",
  "weekOf",
  "weekProgress",
].sort();

describe("@pactjoy/engine public API", () => {
  it("exposes exactly the expected runtime exports", async () => {
    const engine = await import("./index.ts");
    expect(Object.keys(engine).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });
});
