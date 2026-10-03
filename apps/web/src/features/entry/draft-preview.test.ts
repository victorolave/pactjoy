import { describe, expect, it } from "vitest";
import { dailyPreview, weeklyPreview } from "./draft-preview.ts";

/** Leer in the design: minimum 10, ideal 30 min, 250 points over 40 sessions = 6.25 each. */
const reading = {
  minimum: 1000n,
  ideal: 3000n,
  unit: "min",
  perOpportunityExact: { numerator: "25", denominator: "4" },
};

/** Independent reference: exact rational points of one slot, rounded once, half up. */
function reference(
  weight: number,
  opportunities: number,
  value: bigint,
  minimum: bigint,
  ideal: bigint,
): number {
  if (value < minimum) return 0;
  const capped = value < ideal ? value : ideal;
  // weight x 10 points over `opportunities`, times capped / ideal: one fraction, one rounding.
  const numerator = BigInt(weight * 10) * capped;
  const denominator = BigInt(opportunities) * ideal;
  return Number((2n * numerator + denominator) / (2n * denominator));
}

describe("dailyPreview rounds once, from the exact value (review B-W1)", () => {
  it("agrees with a single rounding of the exact fraction over a grid of weights, counts and ideals", () => {
    let checked = 0;
    for (const weight of [5, 10, 15, 25, 35, 40, 60, 75, 100]) {
      for (const opportunities of [3, 7, 8, 12, 13, 24, 28, 40, 56, 84]) {
        // The exact value of one opportunity: weight x 10 / opportunities, reduced or not.
        const exact = { numerator: String(weight * 10), denominator: String(opportunities) };
        for (const ideal of [500n, 1000n, 3000n, 4500n, 15000n]) {
          const minimum = ideal / 3n;
          for (const draftValue of [minimum, (minimum + ideal) / 2n, ideal - 100n, ideal]) {
            const preview = dailyPreview({
              minimum,
              ideal,
              unit: "min",
              perOpportunityExact: exact,
              before: 0n,
              draft: draftValue,
            });
            expect(preview.gain).toBe(reference(weight, opportunities, draftValue, minimum, ideal));
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(9 * 10 * 5 * 4);
  });

  it("computes from the exact fraction itself (150/7 points, half of the way to the ideal)", () => {
    const exact = { numerator: "150", denominator: "7" };
    const preview = dailyPreview({
      minimum: 1000n,
      ideal: 3000n,
      unit: "min",
      perOpportunityExact: exact,
      before: 0n,
      draft: 1500n,
    });
    // 150/7 x 1500/3000 = 10.714... -> 11. The grid above is what pins agreement with one rounding.
    expect(preview.gain).toBe(11);
  });

  it("guards an ideal of zero instead of dividing by it", () => {
    const preview = dailyPreview({
      minimum: 0n,
      ideal: 0n,
      unit: "min",
      perOpportunityExact: { numerator: "25", denominator: "4" },
      before: 0n,
      draft: 100n,
    });
    expect(preview.gain).toBe(0);
    expect(Number.isFinite(preview.fill)).toBe(true);
  });
});

describe("dailyPreview (design 17 and 22)", () => {
  it("below the minimum says how much is missing, earns nothing and keeps the bar neutral", () => {
    const preview = dailyPreview({ ...reading, before: 0n, draft: 500n });
    expect(preview.label).toBe("5 / 30 min");
    expect(preview.gain).toBe(0);
    expect(preview.reached).toBe(false);
    expect(preview.lines).toEqual([
      "5 min más para el mínimo. Aún no cuenta para tu consistencia.",
    ]);
    expect(preview.fill).toBeCloseTo(5 / 30);
  });

  it("from the minimum on says the share of the ideal and earns round(6.25 x 2/3) = 4 (design 17)", () => {
    const preview = dailyPreview({ ...reading, before: 0n, draft: 2000n });
    expect(preview.label).toBe("20 / 30 min");
    expect(preview.gain).toBe(4);
    expect(preview.reached).toBe(true);
    expect(preview.lines).toEqual(["Mínimo cumplido · 67 % del ideal"]);
  });

  it("at the ideal says it, and above it explains no more points come", () => {
    expect(dailyPreview({ ...reading, before: 0n, draft: 3000n }).lines).toEqual([
      "Ideal alcanzado · 100 %",
    ]);
    const over = dailyPreview({ ...reading, before: 2500n, draft: 1000n });
    expect(over.lines).toEqual(["Ideal alcanzado. Por encima de 30 min no suma más puntos."]);
  });

  it("adding on top of what is logged shows the sum and only the points it adds (design 22: +1 pt)", () => {
    const preview = dailyPreview({ ...reading, before: 2500n, draft: 1000n });
    expect(preview.label).toBe("25 + 10 = 35 / 30 min");
    // round(6.25 x 30/30) = 6 minus round(6.25 x 25/30) = 5
    expect(preview.gain).toBe(1);
    expect(preview.fill).toBe(1);
  });

  it("keeps decimals exact and writes them with a comma", () => {
    const preview = dailyPreview({ ...reading, before: 0n, draft: 1250n });
    expect(preview.label).toBe("12,5 / 30 min");
  });

  it("has no points to show when the server gave none for the opportunity", () => {
    expect(
      dailyPreview({ ...reading, perOpportunityExact: null, before: 0n, draft: 2000n }).gain,
    ).toBe(null);
  });
});

/** Inglés in the design: weekly total, minimum 60, ideal 150 min. */
const english = { minimum: 6000n, ideal: 15000n, unit: "min" };

describe("weeklyPreview (design 17b)", () => {
  it("reads 'a -> b / ideal', shows two layers and what is still missing", () => {
    const preview = weeklyPreview({ ...english, before: 9000n, draft: 3000n });
    expect(preview.label).toBe("90 → 120 / 150 min");
    expect(preview.before).toBeCloseTo(0.6);
    expect(preview.fill).toBeCloseTo(0.8);
    expect(preview.lines).toEqual(["80 % del ideal semanal · te faltarían 30 min"]);
  });

  it("below the minimum of the week says so", () => {
    const preview = weeklyPreview({ ...english, before: 0n, draft: 3000n });
    expect(preview.lines).toEqual(["30 min más para el mínimo de la semana"]);
    expect(preview.reached).toBe(false);
  });

  it("at the ideal says it", () => {
    expect(weeklyPreview({ ...english, before: 12000n, draft: 3000n }).lines).toEqual([
      "Ideal semanal alcanzado",
    ]);
  });
});
