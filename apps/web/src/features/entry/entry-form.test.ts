import type { MeasureView } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import {
  initialValue,
  isSubmittable,
  nudge,
  presetsFor,
  quantityMeasureOf,
  type ReachQuantity,
  stepFor,
  toSubmitValue,
} from "./entry-form.ts";

type Quantity = Exclude<MeasureView, { unit: "done" }>;

const perSession = (overrides: Partial<ReachQuantity> = {}): ReachQuantity => ({
  unit: "minutes",
  customLabel: null,
  precision: "integer",
  target: { direction: "reach", minimum: "10", ideal: "30" },
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
  ...overrides,
});

const weekly = (overrides: Partial<ReachQuantity> = {}): ReachQuantity => ({
  unit: "minutes",
  customLabel: null,
  precision: "integer",
  target: { direction: "reach", minimum: "60", ideal: "150" },
  schedule: { period: "weeklyTotal" },
  ...overrides,
});

describe("stepFor", () => {
  it("steps minutes and pages by 5, whole units by 1, and halves for decimal hours and km", () => {
    expect(stepFor(perSession())).toBe("5");
    expect(stepFor(perSession({ unit: "pages" }))).toBe("5");
    expect(stepFor(perSession({ unit: "glasses" }))).toBe("1");
    expect(stepFor(perSession({ unit: "times" }))).toBe("1");
    expect(stepFor(perSession({ unit: "km", precision: "integer" }))).toBe("1");
    expect(stepFor(perSession({ unit: "km", precision: "decimal" }))).toBe("0.5");
    expect(stepFor(perSession({ unit: "hours", precision: "decimal" }))).toBe("0.5");
  });
});

describe("presetsFor", () => {
  it("offers minimum, midpoint and ideal for a per-session reach (design: 10, 20, 30)", () => {
    expect(presetsFor(perSession())).toEqual(["10", "20", "30"]);
  });

  it("rounds the midpoint to the step and keeps decimals exact", () => {
    expect(
      presetsFor(
        perSession({
          unit: "km",
          precision: "decimal",
          target: { direction: "reach", minimum: "3", ideal: "5" },
        }),
      ),
    ).toEqual(["3", "4", "5"]);
    expect(
      presetsFor(
        perSession({
          unit: "km",
          precision: "decimal",
          target: { direction: "reach", minimum: "2", ideal: "3.5" },
        }),
      ),
    ).toEqual(["2", "3", "3.5"]);
  });

  it("offers 10 %, 20 % and 30 % of the ideal for a weekly total (design: 15, 30, 45)", () => {
    expect(presetsFor(weekly())).toEqual(["15", "30", "45"]);
  });

  it("never offers zero or repeats a value, even for a tiny ideal", () => {
    const presets = presetsFor(
      weekly({ unit: "times", target: { direction: "reach", minimum: "1", ideal: "3" } }),
    );
    expect(presets).toEqual(["1"]);
    expect(presets.every((value) => Number(value) > 0)).toBe(true);
  });
});

describe("initialValue", () => {
  it("starts on the midpoint for a per-session reach, and on the second preset for a weekly total", () => {
    expect(initialValue(perSession())).toBe("20");
    expect(initialValue(weekly())).toBe("30");
  });

  it("falls back to the only preset", () => {
    expect(
      initialValue(
        weekly({ unit: "times", target: { direction: "reach", minimum: "1", ideal: "3" } }),
      ),
    ).toBe("1");
  });
});

describe("nudge", () => {
  it("moves by the step in either direction", () => {
    expect(nudge("20", 1, perSession())).toBe("25");
    expect(nudge("20", -1, perSession())).toBe("15");
  });

  it("never goes below zero", () => {
    expect(nudge("3", -1, perSession())).toBe("0");
    expect(nudge("0", -1, perSession())).toBe("0");
  });

  it("keeps decimals exact", () => {
    const km = perSession({ unit: "km", precision: "decimal" });
    expect(nudge("0.5", 1, km)).toBe("1");
    expect(nudge("2.5", 1, km)).toBe("3");
    expect(nudge("0.1", 1, km)).toBe("0.6");
  });

  it("restarts from zero when the text is not a number", () => {
    expect(nudge("abc", 1, perSession())).toBe("5");
  });
});

describe("isSubmittable and toSubmitValue (EN-R3)", () => {
  it("accepts a positive number that fits the precision", () => {
    expect(isSubmittable("10", "integer")).toBe(true);
    expect(isSubmittable("10.5", "decimal")).toBe(true);
    expect(toSubmitValue("10", "integer")).toBe("10");
    expect(toSubmitValue("10,5", "decimal")).toBe("10.5");
  });

  it("blocks zero and anything unreadable (EN-S8)", () => {
    expect(isSubmittable("0", "integer")).toBe(false);
    expect(isSubmittable("", "integer")).toBe(false);
    expect(isSubmittable("abc", "decimal")).toBe(false);
    expect(isSubmittable("-5", "integer")).toBe(false);
  });

  it("blocks decimals for an integer precision, and more than two places for decimal", () => {
    expect(isSubmittable("10.5", "integer")).toBe(false);
    expect(isSubmittable("1.234", "decimal")).toBe(false);
    expect(toSubmitValue("10.5", "integer")).toBeNull();
  });
});

describe("quantityMeasureOf", () => {
  it("returns reach quantities and nothing for done or limit", () => {
    expect(quantityMeasureOf(perSession())).toMatchObject({ unit: "minutes" });
    expect(
      quantityMeasureOf({ unit: "done", schedule: perSession().schedule as never }),
    ).toBeNull();
    const limit: Quantity = {
      ...perSession(),
      target: { direction: "limit", ideal: "1", tolerance: "3" },
    };
    expect(quantityMeasureOf(limit)).toBeNull();
  });
});
