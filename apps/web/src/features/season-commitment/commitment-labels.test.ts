import { describe, expect, it } from "vitest";
import type { CommitmentProgress } from "../../ports/wire.ts";
import { leerRow } from "../../testing/fixtures/season-progress.ts";
import {
  cellLabel,
  cellsHint,
  commitmentSubtitle,
  opportunitiesText,
  perOpportunityText,
  streakCount,
  streakRule,
} from "./commitment-labels.ts";

type Row = Extract<CommitmentProgress, { state: "active" | "ended" }>["commitment"];

const gym: Row = leerRow({
  weightPercent: 30,
  measure: {
    unit: "done",
    schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
  },
});
const coffees: Row = leerRow({
  measure: {
    unit: "times",
    customLabel: null,
    precision: "integer",
    target: { direction: "limit", ideal: "2", tolerance: "4" },
    schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 1, 2] } },
  },
});
const ingles: Row = leerRow({
  measure: {
    unit: "minutes",
    customLabel: null,
    precision: "decimal",
    target: { direction: "reach", minimum: "60", ideal: "150" },
    schedule: { period: "weeklyTotal" },
  },
});

describe("commitment labels (design 24a, 24b)", () => {
  it("the subtitle: schedule, target and weight, as in the design", () => {
    expect(commitmentSubtitle(leerRow())).toBe(
      "5 veces por semana · mínimo 10 min, ideal 30 min · peso 25 %",
    );
    expect(commitmentSubtitle(gym)).toBe("3 veces por semana · hecho / no hecho · peso 30 %");
  });

  it("opportunities kept of counted, nothing while none counted", () => {
    expect(opportunitiesText({ kept: 19, counted: 22 })).toBe("19 de 22 oportunidades");
    expect(opportunitiesText({ kept: 0, counted: 0 })).toBeNull();
  });

  it("streak counts in weeks or days, singular for one", () => {
    expect(streakCount({ unit: "week", current: 0, best: 1 })).toEqual({
      current: "0 semanas",
      best: "1 semana",
    });
    expect(streakCount({ unit: "day", current: 1, best: 12 })).toEqual({
      current: "1 día",
      best: "12 días",
    });
  });

  it("the streak rule: the design's sentence for N a week, the owner's for the rest", () => {
    expect(streakRule(leerRow(), { sessionsDone: 2, sessionsTarget: 5 })).toBe(
      "Una semana suma a la racha cuando cumples las 5 de 5. Esta semana llevas 2 de 5.",
    );
    expect(streakRule(leerRow(), null)).toBe(
      "Una semana suma a la racha cuando cumples las 5 de 5.",
    );
    expect(streakRule(ingles, null)).toBe("Una semana suma a la racha cuando llegas al mínimo.");
    expect(streakRule(coffees, null)).toBe(
      "Un día suma a la racha cuando no pasas de la tolerancia.",
    );
    const daily = leerRow({
      measure: {
        ...ingles.measure,
        schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [1, 3] } },
      } as Row["measure"],
    });
    expect(streakRule(daily, null)).toBe("Un día suma a la racha cuando llegas al mínimo.");
  });

  it("singulars for one opportunity a week (review S3)", () => {
    const once = leerRow({
      measure: {
        ...leerRow().measure,
        schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 1 } },
      } as Row["measure"],
    });
    expect(cellsHint(once)).toBe(
      "Cada celda es tu oportunidad de la semana. Toca una para ver su registro y su nota.",
    );
    expect(streakRule(once, null)).toBe("Una semana suma a la racha cuando cumples la 1 de 1.");
  });

  it("the grid hint names the week's opportunities; nothing for a weekly total", () => {
    const tap = " Toca una para ver su registro y su nota.";
    expect(cellsHint(leerRow())).toBe(
      `Cada celda es una de tus 5 oportunidades de la semana.${tap}`,
    );
    expect(cellsHint(coffees)).toBe(`Cada celda es una de tus 3 oportunidades de la semana.${tap}`);
    expect(cellsHint(ingles)).toBeNull();
  });

  it("cells are named with the legend's words; future ones have no name", () => {
    expect(cellLabel({ status: "ideal", late: false }, false)).toBe("Ideal");
    expect(cellLabel({ status: "minimum", late: true }, false)).toBe(
      "Mínimo, registrado posteriormente",
    );
    for (const status of ["below", "missed", "unrecorded"] as const) {
      expect(cellLabel({ status, late: false }, false)).toBe("No salió");
    }
    expect(cellLabel({ status: "pending", late: false }, true)).toBe("Hoy");
    expect(cellLabel({ status: "pending", late: false }, false)).toBeNull();
    expect(cellLabel({ status: "future", late: false }, false)).toBeNull();
    expect(cellLabel({ status: "paused", late: false }, false)).toBe("Pausa");
    expect(cellLabel({ status: "onHold", late: false }, false)).toBe("En espera");
  });

  it("what one opportunity is worth, rounded for display", () => {
    expect(perOpportunityText("6.25")).toBe("Cada oportunidad vale hasta 6 pts.");
    expect(perOpportunityText(null)).toBeNull();
  });
});
