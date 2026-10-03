import { displayPointsDecimal, fromInt, opportunityValue } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { commitmentId } from "../commitment/commitment.ts";
import { commitmentToEngine } from "../commitment/to-engine.ts";
import { PAUSE_GRACE_EXTENSION_DAYS } from "../entry/entry-window.ts";
import { PER_DAY_REACH } from "../testing/entry-measures.ts";
import { perOpportunityViews } from "./today-rows.ts";

const commitmentOf = (weightPercent: number) =>
  commitmentToEngine({
    id: commitmentId("c"),
    memberId: "m" as never,
    habitId: "h" as never,
    weightPercent,
    privacy: "visible",
    measure: PER_DAY_REACH,
  });

describe("perOpportunityExact is the engine's value, exactly (parity over a grid)", () => {
  it("matches opportunityValue and its 2-decimal display for every weight and opportunity count", () => {
    for (let weight = 5; weight <= 100; weight += 5) {
      for (let opportunities = 1; opportunities <= 84; opportunities += 1) {
        const engine = commitmentOf(weight);
        const views = perOpportunityViews(engine, opportunities);
        const value = opportunityValue(engine, opportunities);
        expect(views.perOpportunityExact).toEqual({
          numerator: value.num.toString(),
          denominator: value.den.toString(),
        });
        expect(views.perOpportunity).toBe(displayPointsDecimal(value));
        // weight x 10 / opportunities, cross-multiplied: no division, no rounding.
        expect(value.num * BigInt(opportunities)).toBe(value.den * BigInt(weight * 10));
      }
    }
  });

  it("has none when the season has no opportunity", () => {
    expect(perOpportunityViews(commitmentOf(50), 0)).toEqual({
      perOpportunity: null,
      perOpportunityExact: null,
    });
    expect(fromInt(0)).toBeDefined();
  });
});

describe("the pause grace extension", () => {
  it("is zero until the pause workflow (A2) wires it, and is defined once, in entry-window.ts", () => {
    expect(PAUSE_GRACE_EXTENSION_DAYS).toBe(0);
  });
});
