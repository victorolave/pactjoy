import { describe, expect, it } from "vitest";
import { fromInt, parseDecimal } from "../fraction/fraction.ts";
import { fr } from "../test-support/fraction-literal.ts";
import { prorateLimitTarget, prorateReachTarget, prorateSessionCount } from "./proration.ts";

describe("prorateSessionCount (D6, timesPerWeek)", () => {
  it("rounds half-up (E3: 3x/week, 4 active days -> 2)", () => {
    expect(prorateSessionCount(3, 4)).toBe(2);
  });

  it("triangulates with a different times/activeDays pair (E4: 3 active days -> 1)", () => {
    expect(prorateSessionCount(3, 3)).toBe(1);
  });

  it("returns null when N prorates to 0 — the whole week is fully paused (D7, E6)", () => {
    expect(prorateSessionCount(3, 1)).toBeNull();
  });
});

describe("prorateReachTarget (D6/D7, weeklyTotal + reach)", () => {
  const ingles = { minimum: fromInt(60), ideal: fromInt(150) };

  it("prorates minimum and ideal, rounding each half-up (E7: 4 active days)", () => {
    const prorated = prorateReachTarget(ingles, 4);
    expect(prorated).toEqual({ direction: "reach", minimum: fromInt(34), ideal: fromInt(86) });
  });

  it("returns null when the governing ideal prorates to 0", () => {
    expect(prorateReachTarget({ minimum: fromInt(0), ideal: fromInt(3) }, 0)).toBeNull();
  });

  it("R5 (engine-authored, no Notion row): a decimal ideal prorates to a whole unit — 3.5km over 1 active day -> 1km", () => {
    const prorated = prorateReachTarget({ minimum: fromInt(0), ideal: parseDecimal("3.5") }, 1);
    expect(prorated).toEqual({ direction: "reach", minimum: fromInt(0), ideal: fromInt(1) });
  });
});

describe("prorateLimitTarget (D6/D7, weeklyTotal + limit)", () => {
  const redes = { ideal: fromInt(300), tolerance: fromInt(420) };

  it("prorates ideal and tolerance, rounding each half-up (E8: 4 active days)", () => {
    const prorated = prorateLimitTarget(redes, 4);
    expect(prorated).toEqual({ direction: "limit", ideal: fromInt(171), tolerance: fromInt(240) });
  });

  it("still counts the week when the governing tolerance is nonzero even with ideal 0 (E9: 4 active days)", () => {
    const prorated = prorateLimitTarget({ ideal: fromInt(0), tolerance: fromInt(2) }, 4);
    expect(prorated).toEqual({ direction: "limit", ideal: fromInt(0), tolerance: fromInt(1) });
  });

  it("returns null when the governing tolerance prorates to 0 (D7, E10: 1 active day)", () => {
    expect(prorateLimitTarget({ ideal: fromInt(0), tolerance: fromInt(2) }, 1)).toBeNull();
  });

  it("R5: a decimal tolerance still rounds to a whole unit (triangulation beyond the Notion rows)", () => {
    const prorated = prorateLimitTarget({ ideal: fromInt(0), tolerance: parseDecimal("3.5") }, 1);
    expect(prorated).toEqual({ direction: "limit", ideal: fromInt(0), tolerance: fr("1") });
  });
});
