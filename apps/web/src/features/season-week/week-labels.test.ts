import { describe, expect, it } from "vitest";
import type { WeekSummary } from "../../ports/wire.ts";
import { weekSummary } from "../../testing/fixtures/season-progress.ts";
import {
  bannerDetail,
  breakdownText,
  circleLine,
  headlineText,
  weekMeta,
  weekRangeText,
  weeksLeftText,
} from "./week-labels.ts";

type Row = WeekSummary["commitments"][number];

describe("week labels (design 25a–c)", () => {
  it("dates of a week inside one month, and across two", () => {
    expect(weekRangeText("2026-09-15", "2026-09-21")).toBe("15–21 sep");
    expect(weekRangeText("2026-08-25", "2026-10-19")).toBe("25 ago – 19 oct");
  });

  it("the meta line: week of the season and its dates", () => {
    expect(weekMeta(weekSummary({ start: "2026-09-15", end: "2026-09-21" }))).toBe(
      "Semana 4 de 8 · 15–21 sep",
    );
  });

  it("only the two approved headlines exist; otherwise none", () => {
    expect(headlineText("best")).toBe("Tu mejor semana hasta ahora.");
    expect(headlineText("difficult")).toBe("Esta semana ha costado más.");
    expect(headlineText(null)).toBeNull();
  });

  it("weeks left after a difficult week: plural, singular, none in the final week", () => {
    expect(weeksLeftText(6)).toBe("Todavía tienes oportunidades: quedan 6 semanas.");
    expect(weeksLeftText(1)).toBe("Todavía tienes oportunidades: queda 1 semana.");
    expect(weeksLeftText(0)).toBeNull();
  });

  it("the banner line under 'Semana N cerrada', with an em dash when nothing counted", () => {
    expect(bannerDetail(weekSummary())).toBe("+96 pts · consistencia 83 %");
    expect(bannerDetail(weekSummary({ points: 1, consistency: null }))).toBe(
      "+1 pt · consistencia —",
    );
  });

  describe("breakdown rows", () => {
    const [leer] = weekSummary().commitments as [Row];

    it("a per-session commitment: sessions done of target, then its points", () => {
      expect(breakdownText(leer)).toBe("4 de 5 · +20 pts");
    });

    it("a weekly total to reach: value over ideal with its unit", () => {
      const ingles: Row = {
        ...leer,
        measure: {
          unit: "minutes",
          customLabel: null,
          precision: "decimal",
          target: { direction: "reach", minimum: "60", ideal: "150" },
          schedule: { period: "weeklyTotal" },
        },
        points: 26,
        progress: {
          value: "125",
          target: { direction: "reach", minimum: "60", ideal: "150" },
          sessionsDone: 1,
          sessionsTarget: 1,
          percent: 83,
        },
      };
      expect(breakdownText(ingles)).toBe("125 / 150 min · +26 pts");
    });

    it("a weekly total not to exceed: value, the Today target text, points", () => {
      const redes: Row = {
        ...leer,
        measure: {
          unit: "minutes",
          customLabel: null,
          precision: "decimal",
          target: { direction: "limit", ideal: "300", tolerance: "420" },
          schedule: { period: "weeklyTotal" },
        },
        points: 12,
        progress: {
          value: "240",
          target: { direction: "limit", ideal: "300", tolerance: "420" },
          sessionsDone: 1,
          sessionsTarget: 1,
          percent: 100,
        },
      };
      expect(breakdownText(redes)).toMatch(/^240 min · .+ · \+12 pts$/);
    });

    it("a week paused whole reads 'En pausa', with no points", () => {
      expect(breakdownText({ ...leer, points: null, progress: null })).toBe("En pausa");
    });
  });

  it("circle line (pair only): the peer first, then 'tú'", () => {
    expect(circleLine(weekSummary())).toBe("En el círculo: Andrea +87 · tú +96");
    expect(circleLine(weekSummary({ circle: null }))).toBeNull();
    const pending = weekSummary({
      circle: [
        { memberId: "member-andrea", displayName: "Andrea", points: null },
        { memberId: "member-victor", displayName: "Victor", points: 96 },
      ],
    });
    expect(circleLine(pending)).toBe("En el círculo: Andrea — · tú +96");
  });
});
