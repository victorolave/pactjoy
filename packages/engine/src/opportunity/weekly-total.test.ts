import { describe, expect, it } from "vitest";
import { seasonDay } from "../calendar/season-calendar";
import type { Target } from "../commitment/commitment";
import { fromInt, parseDecimal } from "../fraction/fraction";
import { buildQuantityEntry } from "../test-support/builders";
import { fr } from "../test-support/fraction-literal";
import { weeklyTotalResult } from "./weekly-total";

const inglesTarget: Target = { direction: "reach", minimum: fromInt(60), ideal: fromInt(150) };

describe("weeklyTotalResult", () => {
  it("sums entries across different days of the week before evaluating progress", () => {
    const entries = [
      buildQuantityEntry("ingles", 0, parseDecimal("50")),
      buildQuantityEntry("ingles", 3, parseDecimal("50")),
      buildQuantityEntry("ingles", 6, parseDecimal("50")),
    ];
    const result = weeklyTotalResult(inglesTarget, 0, entries);
    expect(result.value).toEqual(parseDecimal("150"));
    expect(result.progress).toEqual(fr("1"));
    expect(result.consistent).toBe(true);
  });

  it("returns a null value and zero progress when the week has no entries at all", () => {
    const result = weeklyTotalResult(inglesTarget, 0, []);
    expect(result.value).toBeNull();
    expect(result.progress).toEqual(fr("0"));
    expect(result.consistent).toBe(false);
  });

  it("discards a late entry recorded after the week's own grace deadline", () => {
    const entries = [
      buildQuantityEntry("ingles", 0, parseDecimal("120")),
      // week 0 ends day 6, deadline is day 7 — recorded day 8 is late
      buildQuantityEntry("ingles", 6, parseDecimal("30"), 8),
    ];
    const result = weeklyTotalResult(inglesTarget, 0, entries);
    expect(result.value).toEqual(parseDecimal("120"));
    expect(result.progress).toEqual(fr("4/5"));
    expect(result.consistent).toBe(true);
  });

  it("counts a late entry recorded exactly on the grace deadline", () => {
    const entries = [
      buildQuantityEntry("ingles", 0, parseDecimal("120")),
      buildQuantityEntry("ingles", 6, parseDecimal("30"), 7),
    ];
    const result = weeklyTotalResult(inglesTarget, 0, entries);
    expect(result.value).toEqual(parseDecimal("150"));
    expect(result.progress).toEqual(fr("1"));
  });

  it("honors a custom deadlineFor policy instead of the default graceDeadline — without touching recordedOn", () => {
    const entry = buildQuantityEntry("ingles", 6, parseDecimal("30"), 8); // normally late (deadline day 7)
    const originalRecordedOn = entry.recordedOn;
    const alwaysLate = () => seasonDay(8); // extend the week's deadline out to day 8
    const result = weeklyTotalResult(
      inglesTarget,
      0,
      [buildQuantityEntry("ingles", 0, parseDecimal("120")), entry],
      alwaysLate,
    );
    expect(result.value).toEqual(parseDecimal("150")); // now counted, per the custom policy
    expect(entry.recordedOn).toBe(originalRecordedOn); // the entry itself was never rewritten
  });

  it("evaluates each week independently — excess progress in one week never compensates another", () => {
    const week0 = weeklyTotalResult(inglesTarget, 0, [
      buildQuantityEntry("ingles", 0, parseDecimal("300")),
    ]);
    const week1 = weeklyTotalResult(inglesTarget, 1, []);
    expect(week0.progress).toEqual(fr("1")); // capped, not carried as "2"
    expect(week1.progress).toEqual(fr("0")); // unaffected by week 0's excess
  });
});
