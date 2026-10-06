import { describe, expect, it } from "vitest";
import { changeWeight, equalWeights, weightSummary } from "./weights-model.ts";

describe("pact weights (WF-R5)", () => {
  it("changes by five, clamps at five and one hundred, and rejects off-step weights", () => {
    expect([
      changeWeight(25, 5),
      changeWeight(25, -5),
      changeWeight(5, -5),
      changeWeight(100, 5),
    ]).toEqual([30, 20, 5, 100]);
    expect(() => changeWeight(5.5, 5)).toThrow(RangeError);
    expect(() => changeWeight(7, 5)).toThrow(RangeError);
    expect(() => changeWeight(33, -5)).toThrow(RangeError);
  });
  it.each([
    [0, []],
    [1, [100]],
    [3, [35, 35, 30]],
    [6, [20, 20, 15, 15, 15, 15]],
  ])("equal split for %i habits assigns remainder to the first rows", (count, weights) => {
    expect(equalWeights(count as number)).toEqual(weights);
  });
  it("cannot equally distribute twenty-one habits with a minimum of five", () => {
    expect(equalWeights(20)).toEqual(Array(20).fill(5));
    expect(equalWeights(21)).toBeNull();
  });
  const invalid = "Cada peso va de 5 % a 100 %, en pasos de 5 %";
  it.each([
    [[25, 25], 50, false, "Te faltan 50 %", "neutral"],
    [[75, 50], 125, false, "Te sobran 25 %", "neutral"],
    [[50, 50], 100, true, "Listo", "success"],
    [[], 0, false, "Te faltan 100 %", "neutral"],
    [[4, 96], 100, false, invalid, "neutral"],
    [[49.5, 50.5], 100, false, invalid, "neutral"],
    [[33, 67], 100, false, invalid, "neutral"],
  ])(
    "summarizes %j without approving on behalf of the server",
    (weights, total, canContinue, message, tone) => {
      expect(weightSummary(weights as number[])).toEqual({ total, canContinue, message, tone });
    },
  );
});
