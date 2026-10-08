import type { MeasureView } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import type { Serialized } from "../../ports/wire.ts";
import { commitmentSubtitle, hiddenSubtitle, pointsOfPossible } from "./member-labels.ts";

type Measure = Serialized<MeasureView>;

const reach = (schedule: Exclude<Measure, { unit: "done" }>["schedule"]): Measure => ({
  unit: "minutes",
  customLabel: null,
  precision: "decimal",
  target: { direction: "reach", minimum: "10", ideal: "30" },
  schedule,
});
const timesPerWeek = (times: number) =>
  reach({ period: "perSession", frequency: { kind: "timesPerWeek", times } });
const days = (weekdays: (0 | 1 | 2 | 3 | 4 | 5 | 6)[]) =>
  reach({ period: "perSession", frequency: { kind: "specificDays", weekdays } });
const weekly = reach({ period: "weeklyTotal" });
const coffees: Measure = {
  unit: "times",
  customLabel: null,
  precision: "integer",
  target: { direction: "limit", ideal: "2", tolerance: "3" },
  schedule: {
    period: "perSession",
    frequency: { kind: "specificDays", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
};

describe("commitmentSubtitle (design 23d)", () => {
  it.each([
    ["3 veces/sem · 11 de 13 sesiones", timesPerWeek(3), 11, 13],
    ["Todos los días · 27 de 31 días", days([0, 1, 2, 3, 4, 5, 6]), 27, 31],
    ["No exceder · 25 de 31 días", coffees, 25, 31],
  ])("the design's own rows: %s", (expected, measure, kept, counted) => {
    expect(commitmentSubtitle(measure, { kept, counted })).toBe(expected);
  });

  it.each([
    ["1 vez/sem · 2 de 4 sesiones", timesPerWeek(1), 2, 4],
    ["Mar · jue · sáb · 5 de 9 días", days([1, 3, 5]), 5, 9],
    ["Total de la semana · 3 de 4 semanas", weekly, 3, 4],
    ["3 veces/sem · 1 de 1 sesión", timesPerWeek(3), 1, 1],
    ["Todos los días · 0 de 1 día", days([0, 1, 2, 3, 4, 5, 6]), 0, 1],
    ["Total de la semana · 1 de 1 semana", weekly, 1, 1],
  ])("owner-approved generalization: %s", (expected, measure, kept, counted) => {
    expect(commitmentSubtitle(measure, { kept, counted })).toBe(expected);
  });

  it("with nothing counted yet it shows only the frequency", () => {
    expect(commitmentSubtitle(timesPerWeek(3), { kept: 0, counted: 0 })).toBe("3 veces/sem");
  });

  it("a done / not done habit reads like any other frequency", () => {
    const gym: Measure = {
      unit: "done",
      schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
    };
    expect(commitmentSubtitle(gym, { kept: 6, counted: 9 })).toBe("3 veces/sem · 6 de 9 sesiones");
  });
});

describe("private and points labels (design 23d)", () => {
  it("a private commitment shows only its weight", () => {
    expect(hiddenSubtitle(30)).toBe("Peso 30 %");
  });

  it("points over the commitment's possible points (weight x 10)", () => {
    expect(pointsOfPossible(120, 30)).toBe("120 / 300");
  });
});
