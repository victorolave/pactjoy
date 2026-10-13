import { describe, expect, it } from "vitest";
import {
  commitmentFigures,
  percentText,
  periodHeading,
  periodMeta,
  pointsLabel,
  weeksPhrase,
} from "./review-format.ts";

describe("periodMeta and periodHeading (33)", () => {
  it("names the two weeks of the period, as designed", () => {
    expect(periodMeta({ first: 3, last: 4 })).toBe("Revisión privada · semanas 3 y 4");
    expect(periodHeading({ first: 3, last: 4 })).toBe("Así fueron tus dos últimas semanas");
  });

  it("handles one week, three weeks and longer periods", () => {
    expect(periodMeta({ first: 4, last: 4 })).toBe("Revisión privada · semana 4");
    expect(periodHeading({ first: 4, last: 4 })).toBe("Así fue tu última semana");
    expect(periodMeta({ first: 4, last: 6 })).toBe("Revisión privada · semanas 4 a 6");
    expect(periodHeading({ first: 4, last: 6 })).toBe("Así fueron tus tres últimas semanas");
    expect(periodHeading({ first: 1, last: 12 })).toBe("Así fueron tus últimas 12 semanas");
  });
});

describe("the figures", () => {
  it("prints percents with a space and a dash for nothing counted", () => {
    expect(percentText(83)).toBe("83 %");
    expect(percentText(null)).toBe("–");
  });

  it("prints points with a sign", () => {
    expect(pointsLabel(184)).toBe("+184");
    expect(pointsLabel(0)).toBe("0");
  });

  it("writes a commitment's line like the design: kept of counted, then the ideal", () => {
    const base = {
      commitmentId: "c",
      habitName: "Leer",
      icon: null,
      scheduleKind: "perSession",
      kept: 9,
      counted: 10,
      consistencyPercent: 90,
      idealPercent: 80,
      points: 60,
    } as const;
    expect(commitmentFigures(base)).toBe("9 de 10 · ideal 80 %");
    expect(
      commitmentFigures({
        ...base,
        scheduleKind: "weeklyTotal",
        kept: 2,
        counted: 2,
        idealPercent: 72,
      }),
    ).toBe("2 de 2 semanas · ideal 72 %");
  });

  it("W1: one counted week is singular", () => {
    expect(
      commitmentFigures({
        commitmentId: "c",
        habitName: "Leer",
        icon: null,
        scheduleKind: "weeklyTotal",
        kept: 1,
        counted: 1,
        consistencyPercent: 100,
        idealPercent: null,
        points: 50,
      }),
    ).toBe("1 de 1 semana");
  });

  it("shows only 'sin datos' when nothing counted in the period (fully paused)", () => {
    expect(
      commitmentFigures({
        commitmentId: "c",
        habitName: "Gym",
        icon: null,
        scheduleKind: "perSession",
        kept: 0,
        counted: 0,
        consistencyPercent: null,
        idealPercent: null,
        points: 0,
      }),
    ).toBe("Sin oportunidades en el periodo");
  });

  it("drops the ideal when it is absent", () => {
    expect(
      commitmentFigures({
        commitmentId: "c",
        habitName: "Gym",
        icon: null,
        scheduleKind: "perSession",
        kept: 3,
        counted: 6,
        consistencyPercent: 50,
        idealPercent: null,
        points: 30,
      }),
    ).toBe("3 de 6");
  });
});

describe("weeksPhrase (the Today card and the Temporada notice)", () => {
  it("names the weeks with their article, in the singular for one", () => {
    expect(weeksPhrase({ first: 3, last: 4 })).toBe("las semanas 3 y 4");
    expect(weeksPhrase({ first: 4, last: 4 })).toBe("la semana 4");
    expect(weeksPhrase({ first: 4, last: 6 })).toBe("las semanas 4 a 6");
  });
});
