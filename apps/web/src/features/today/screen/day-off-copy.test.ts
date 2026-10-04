import { describe, expect, it } from "vitest";
import { dayRowFixture, weekRowFixture } from "../../../testing/fixtures/today.ts";
import { dayOffText, nextWeekdayName } from "./day-off-copy.ts";

/** 2026-09-27 is a Sunday (Monday-first weekday 6). */
const SUNDAY = "2026-09-27";

describe("nextWeekdayName", () => {
  it("names the next scheduled weekday after the given day", () => {
    // Tuesday (1) and Thursday (3); from Sunday the next one is Tuesday.
    expect(nextWeekdayName([1, 3], SUNDAY)).toBe("martes");
    // From Tuesday itself, strictly after: Thursday.
    expect(nextWeekdayName([1, 3], "2026-09-29")).toBe("jueves");
  });

  it("wraps to the first weekday of the next week", () => {
    expect(nextWeekdayName([0], "2026-09-30")).toBe("lunes");
  });
});

const reading = (done: number) =>
  weekRowFixture({
    habitName: "Leer",
    progress: {
      value: "150",
      target: { direction: "reach", minimum: "10", ideal: "30" },
      sessionsDone: done,
      sessionsTarget: 5,
      percent: 100,
    },
  });

const drawing = dayRowFixture({
  habitName: "Dibujar",
  scheduledToday: false,
  measure: {
    unit: "done",
    schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [1, 3, 5] } },
  },
});

describe("dayOffText (design 15c)", () => {
  it("says the best sessions count once the week's frequency is met, and when the day habit returns", () => {
    expect(dayOffText([reading(5)], [drawing], SUNDAY)).toBe(
      "Leer ya va 5 de 5 esta semana. Si lo haces hoy, cuentan tus 5 mejores sesiones: una más larga puede sustituir a la más corta y sumar puntos. Dibujar vuelve el martes.",
    );
  });

  it("only reports the count while the frequency is not met", () => {
    expect(dayOffText([reading(3)], [], SUNDAY)).toBe("Leer va 3 de 5 esta semana.");
  });

  it("is empty when there is nothing to say", () => {
    expect(dayOffText([], [], SUNDAY)).toBe("");
  });

  it("ignores weekly totals: they have no sessions to rank", () => {
    const total = weekRowFixture({
      measure: {
        unit: "minutes",
        customLabel: null,
        precision: "integer",
        target: { direction: "reach", minimum: "60", ideal: "150" },
        schedule: { period: "weeklyTotal" },
      },
    });
    expect(dayOffText([total], [], SUNDAY)).toBe("");
  });
});
