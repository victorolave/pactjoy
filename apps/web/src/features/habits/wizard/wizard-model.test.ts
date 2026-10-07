import { describe, expect, it } from "vitest";
import type { HabitDto } from "../../../ports/wire.ts";
import {
  habitPatch,
  initialWizard,
  prefillWizard,
  previewValues,
  wizardFields,
  wizardReducer,
} from "./wizard-model.ts";

const habit: HabitDto = {
  id: "h1",
  name: "Leer",
  why: "Aprender",
  category: "Leer",
  icon: "book",
  createdAt: "2026-10-01T00:00:00Z",
  version: 3,
};

describe("habit wizard model", () => {
  it("keeps preview samples inside the API's nine-integer-digit boundary", () => {
    expect(
      previewValues({
        unit: "pages",
        direction: "reach",
        minimum: "999999998",
        ideal: "999999999",
        schedule: { period: "weeklyTotal" },
      }),
    ).toEqual(["0", "999999998", "999999998.5", "999999999"]);
  });

  it("prefills categories from design, including an empty custom name", () => {
    expect(initialWizard()).toMatchObject({
      name: "Leer",
      icon: "book",
      category: "Leer",
      measure: { unit: "minutes", minimum: "10", ideal: "30" },
    });
    expect(
      wizardReducer(initialWizard(), { type: "category", category: "Movimiento" }),
    ).toMatchObject({
      name: "Movimiento",
      icon: "footprints",
      measure: { unit: "km", minimum: "2", ideal: "5" },
    });
    expect(
      wizardReducer(initialWizard(), { type: "category", category: "Crear el mío" }),
    ).toMatchObject({ name: "", icon: "flower", measure: { unit: "done" } });
  });

  it("done has only a frequency and hides direction, period and thresholds", () => {
    const done = wizardReducer(initialWizard(), { type: "unit", unit: "done" });
    expect(done.measure).toEqual({ unit: "done", frequency: { kind: "timesPerWeek", times: 5 } });
    expect(wizardFields(done.measure)).toEqual({
      quantity: false,
      frequency: true,
      threshold: "Mínimo",
    });
    expect(wizardFields(initialWizard().measure)).toEqual({
      quantity: true,
      frequency: true,
      threshold: "Mínimo",
    });
  });

  it("limit per session is daily and calls the threshold tolerance", () => {
    const limit = wizardReducer(initialWizard(), { type: "direction", direction: "limit" });
    expect(limit.measure).toEqual({
      unit: "minutes",
      direction: "limit",
      ideal: "30",
      tolerance: "60",
      schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 7 } },
    });
    expect(wizardFields(limit.measure)).toEqual({
      quantity: true,
      frequency: false,
      threshold: "Tolerancia",
    });
    const weekly = wizardReducer(limit, { type: "period", period: "weeklyTotal" });
    expect(weekly.measure).toMatchObject({
      direction: "limit",
      schedule: { period: "weeklyTotal" },
    });
    expect(wizardFields(weekly.measure).frequency).toBe(false);
  });

  it("changing period or unit proposes the corresponding design defaults", () => {
    const weekly = wizardReducer(initialWizard(), { type: "period", period: "weeklyTotal" });
    expect(weekly.measure).toMatchObject({
      minimum: "60",
      ideal: "150",
      schedule: { period: "weeklyTotal" },
    });
    expect(wizardReducer(weekly, { type: "unit", unit: "hours" }).measure).toMatchObject({
      unit: "hours",
      minimum: "3",
      ideal: "6",
    });
  });

  it("chooses exact decimal samples without computing any score", () => {
    expect(previewValues(initialWizard().measure)).toEqual(["0", "10", "20", "30", "35"]);
    expect(
      previewValues({
        unit: "km",
        direction: "limit",
        ideal: "0.1",
        tolerance: "0.3",
        schedule: { period: "weeklyTotal" },
      }),
    ).toEqual(["0.1", "0.2", "0.3", "1.3"]);
    expect(previewValues({ unit: "done", frequency: { kind: "timesPerWeek", times: 3 } })).toEqual([
      "1",
      "0",
    ]);
  });

  it("deduplicates equal thresholds and rejects malformed preview drafts", () => {
    expect(
      previewValues({
        unit: "pages",
        direction: "reach",
        minimum: "10",
        ideal: "10",
        schedule: { period: "weeklyTotal" },
      }),
    ).toEqual(["0", "10", "15"]);
    expect(
      previewValues({
        ...initialWizard().measure,
        unit: "km",
        direction: "reach",
        minimum: "bad",
        ideal: "2",
        schedule: { period: "weeklyTotal" },
      }),
    ).toEqual([]);
  });

  it("prefills an existing habit without inventing a commitment", () => {
    expect(prefillWizard(habit)).toMatchObject({
      name: "Leer",
      why: "Aprender",
      category: "Leer",
      icon: "book",
      measure: { unit: "minutes", minimum: "10", ideal: "30" },
    });
    expect(
      prefillWizard({ ...habit, name: "Mi hábito", category: null, icon: null }),
    ).toMatchObject({ name: "Mi hábito", category: null, icon: null });
  });

  it("prefills commitment thresholds, frequency and privacy without losing decimals", () => {
    expect(
      prefillWizard(habit, {
        id: "c1",
        kind: "detail",
        habitId: "h1",
        memberId: "member-victor",
        weightPercent: 25,
        privacy: "private",
        measure: {
          unit: "km",
          precision: "decimal",
          customLabel: null,
          target: { direction: "reach", minimum: "0.15", ideal: "0.75" },
          schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 4] } },
        },
      }),
    ).toMatchObject({
      privacy: "private",
      measure: {
        unit: "km",
        minimum: "0.15",
        ideal: "0.75",
        schedule: { frequency: { weekdays: [0, 4] } },
      },
    });
    expect(
      prefillWizard(habit, {
        id: "c1",
        kind: "detail",
        habitId: "h1",
        memberId: "member-victor",
        weightPercent: 25,
        privacy: "visible",
        measure: {
          unit: "done",
          schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 7 } },
        },
      }).measure,
    ).toEqual({ unit: "done", frequency: { kind: "timesPerWeek", times: 7 } });
  });

  it("avoids a PATCH when metadata is unchanged and includes only changed fields", () => {
    const draft = prefillWizard(habit);
    expect(habitPatch(habit, draft)).toBeNull();
    expect(habitPatch(habit, { ...draft, why: "", icon: null, category: null })).toEqual({
      expectedVersion: 3,
      why: null,
      icon: null,
      category: null,
    });
    expect(habitPatch(habit, { ...draft, name: "Lectura" })).toEqual({
      expectedVersion: 3,
      name: "Lectura",
    });
  });
});
