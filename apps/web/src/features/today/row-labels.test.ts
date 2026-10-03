import type { MeasureView, TodayEntry } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { dayRowFixture } from "../../testing/fixtures/today.ts";
import {
  entryText,
  formatDecimal,
  quantityText,
  scheduleText,
  targetText,
  unitLabel,
  weekdaysText,
} from "./row-labels.ts";

type Quantity = Exclude<MeasureView, { unit: "done" }>;

const minutes: Quantity = {
  unit: "minutes",
  customLabel: null,
  precision: "integer",
  target: { direction: "reach", minimum: "10", ideal: "30" },
  schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
};
const limitTimes: Quantity = {
  unit: "times",
  customLabel: null,
  precision: "integer",
  target: { direction: "limit", ideal: "1", tolerance: "3" },
  schedule: { period: "weeklyTotal" },
};

describe("formatDecimal", () => {
  it("writes decimals with a comma and leaves integers alone", () => {
    expect(formatDecimal("30")).toBe("30");
    expect(formatDecimal("0.5")).toBe("0,5");
    expect(formatDecimal("12.25")).toBe("12,25");
  });
});

describe("unitLabel", () => {
  it.each([
    ["minutes", "min"],
    ["hours", "h"],
    ["times", "veces"],
    ["pages", "págs."],
    ["km", "km"],
    ["glasses", "vasos"],
  ] as const)("labels %s as %s", (unit, label) => {
    expect(unitLabel({ ...minutes, unit })).toBe(label);
  });

  it("uses the custom label for a custom unit", () => {
    expect(unitLabel({ ...minutes, unit: "custom", customLabel: "capítulos" })).toBe("capítulos");
  });

  it("has no unit for done/not done", () => {
    expect(unitLabel(dayRowFixture().measure)).toBeNull();
  });
});

describe("quantityText", () => {
  it("joins the number and the unit", () => {
    expect(quantityText("30", minutes)).toBe("30 min");
    expect(quantityText("0.5", { ...minutes, unit: "hours" })).toBe("0,5 h");
  });

  it("uses the singular for exactly one", () => {
    expect(quantityText("1", { ...minutes, unit: "times" })).toBe("1 vez");
    expect(quantityText("2", { ...minutes, unit: "times" })).toBe("2 veces");
    expect(quantityText("1", { ...minutes, unit: "glasses" })).toBe("1 vaso");
    expect(quantityText("1", { ...minutes, unit: "pages" })).toBe("1 pág.");
    expect(quantityText("1", minutes)).toBe("1 min");
    expect(quantityText("1.5", { ...minutes, unit: "times" })).toBe("1,5 veces");
  });

  it("is just the number for a done measure", () => {
    expect(quantityText("1", dayRowFixture().measure)).toBe("1");
  });
});

describe("targetText", () => {
  it("states minimum and ideal for reach", () => {
    expect(targetText(minutes)).toBe("mín. 10 · ideal 30 min");
  });

  it("states ideal and tolerance for limit", () => {
    expect(targetText(limitTimes)).toBe("ideal hasta 1 · tolerancia 3 veces");
  });

  it("has no target for done/not done", () => {
    expect(targetText(dayRowFixture().measure)).toBeNull();
  });
});

describe("weekdaysText and scheduleText", () => {
  it("lists weekdays starting on Monday", () => {
    expect(weekdaysText([0, 2, 4])).toBe("Lun · mié · vie");
    expect(weekdaysText([1, 3, 5])).toBe("Mar · jue · sáb");
    expect(weekdaysText([6])).toBe("Dom");
  });

  it("describes a specific-days schedule by its days", () => {
    expect(scheduleText(dayRowFixture().measure)).toBe("Lun · mié · vie");
  });

  it("describes times per week and weekly total", () => {
    expect(scheduleText(minutes)).toBe("3 veces por semana");
    expect(scheduleText(limitTimes)).toBe("Total de la semana");
  });
});

describe("entryText on another day (B-W1)", () => {
  const entry = (value: TodayEntry["value"], forDate: string): TodayEntry => ({
    entryId: "e" as TodayEntry["entryId"],
    forDate: forDate as TodayEntry["forDate"],
    value,
    note: null,
  });
  const done = dayRowFixture().measure;

  it("says the weekday, not hoy, for an entry of yesterday", () => {
    expect(entryText(entry({ kind: "done" }, "2026-10-01"), done, "2026-10-02")).toBe(
      "Registrado el jueves",
    );
    expect(entryText(entry({ kind: "missed" }, "2026-10-01"), done, "2026-10-02")).toBe(
      "No salió el jueves",
    );
    expect(
      entryText(entry({ kind: "quantity", value: "25" }, "2026-10-01"), minutes, "2026-10-02"),
    ).toBe("25 min · jueves");
  });

  it("keeps the hoy wording for an entry of today, or when today is not known", () => {
    expect(entryText(entry({ kind: "done" }, "2026-10-02"), done, "2026-10-02")).toBe(
      "Registrado hoy",
    );
    expect(entryText(entry({ kind: "done" }, "2026-10-01"), done)).toBe("Registrado hoy");
  });
});

describe("entryText", () => {
  it("says done, missed and a quantity in the row's unit", () => {
    const entry = (value: TodayEntry["value"]): TodayEntry => ({
      entryId: "e" as TodayEntry["entryId"],
      forDate: "2026-10-02" as TodayEntry["forDate"],
      value,
      note: null,
    });
    const done = dayRowFixture().measure;
    expect(entryText(entry({ kind: "done" }), done)).toBe("Registrado hoy");
    expect(entryText(entry({ kind: "missed" }), done)).toBe("Hoy no salió");
    expect(entryText(entry({ kind: "quantity", value: "25" }), minutes)).toBe("25 min");
  });
});
