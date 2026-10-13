import { describe, expect, it } from "vitest";
import {
  CONSISTENCY_EMPTY,
  CONSISTENCY_ERROR,
  consistencyPercentText,
  consistencySeasonLines,
  HABITS_ERROR,
  OUT_OF_SEASON_NOTE,
} from "./profile-sections.ts";

const consistency = (
  over: Partial<{ percent: number | null; closedSeasons: number; inProgress: boolean }> = {},
) => ({ kept: 21, counted: 25, percent: 84, closedSeasons: 0, inProgress: true, ...over });

describe("consistencyPercentText", () => {
  it('writes the server percent as "{p} %" with no client rounding', () => {
    expect(consistencyPercentText(84)).toBe("84 %");
    expect(consistencyPercentText(0)).toBe("0 %");
    expect(consistencyPercentText(100)).toBe("100 %");
  });
});

describe("consistencySeasonLines (design 39: '1 temporada / en curso')", () => {
  it("one season in progress is the design's two lines", () => {
    expect(consistencySeasonLines(consistency())).toEqual(["1 temporada", "en curso"]);
  });

  it("counts closed seasons plus the one in progress, in the plural", () => {
    expect(consistencySeasonLines(consistency({ closedSeasons: 2 }))).toEqual([
      "3 temporadas",
      "1 en curso",
    ]);
  });

  it("closed seasons alone are one line, singular or plural", () => {
    expect(consistencySeasonLines(consistency({ closedSeasons: 1, inProgress: false }))).toEqual([
      "1 temporada",
    ]);
    expect(consistencySeasonLines(consistency({ closedSeasons: 2, inProgress: false }))).toEqual([
      "2 temporadas",
    ]);
  });

  it("has no lines when nothing contributes", () => {
    expect(consistencySeasonLines(consistency({ closedSeasons: 0, inProgress: false }))).toEqual(
      [],
    );
  });
});

describe("copy", () => {
  it("never promises a closed season when one is already in progress", () => {
    expect(CONSISTENCY_EMPTY({ inProgress: true })).toBe("Aún sin datos.");
    expect(CONSISTENCY_EMPTY({ inProgress: false })).toBe(
      "Aún sin datos. La verás cuando cierres tu primera temporada.",
    );
  });

  it("keeps the fixed strings", () => {
    expect(OUT_OF_SEASON_NOTE).toBe("Fuera de esta temporada");
    expect(CONSISTENCY_ERROR).toBe("No pudimos cargar tu consistencia.");
    expect(HABITS_ERROR).toBe("No pudimos cargar tus hábitos.");
  });
});
