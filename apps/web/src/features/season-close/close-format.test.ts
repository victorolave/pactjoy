import { describe, expect, it } from "vitest";
import {
  automaticityLabel,
  finalStandingsFootnote,
  graduationLead,
  percentText,
  shortDate,
  stageLine,
} from "./close-format.ts";

describe("percentText", () => {
  it("writes a percentage with a space before the sign, and a dash when nothing was counted", () => {
    expect(percentText(85)).toBe("85 %");
    expect(percentText(0)).toBe("0 %");
    expect(percentText(null)).toBe("–");
  });
});

describe("shortDate", () => {
  it("writes the day and the three-letter month (25 ago)", () => {
    expect(shortDate("2026-08-25")).toBe("25 ago");
    expect(shortDate("2026-10-19")).toBe("19 oct");
    expect(shortDate("2027-01-03")).toBe("3 ene");
    expect(shortDate("2026-09-01")).toBe("1 sep");
  });

  it("returns what it cannot read, untouched", () => {
    expect(shortDate("mañana")).toBe("mañana");
  });
});

describe("automaticityLabel", () => {
  it("writes start and end with an arrow, keeping the decimal comma", () => {
    expect(automaticityLabel({ from: "3,5", to: "5,8" })).toBe("3,5 → 5,8");
    expect(automaticityLabel({ from: "3", to: "5" })).toBe("3 → 5");
  });

  it("writes only the end when there was no start", () => {
    expect(automaticityLabel({ from: null, to: "4,2" })).toBe("4,2");
  });

  it("says nothing without the closing score", () => {
    expect(automaticityLabel({ from: "3,5", to: null })).toBeNull();
    expect(automaticityLabel({ from: null, to: null })).toBeNull();
  });
});

describe("finalStandingsFootnote", () => {
  it("gives the gap between first and second and calls a close season close", () => {
    expect(finalStandingsFootnote([792, 798])).toBe(
      "6 pts de diferencia. Fue una temporada muy pareja.",
    );
  });

  it("says a close season only when the gap is at most 20 points", () => {
    expect(finalStandingsFootnote([800, 779])).toBe("21 pts de diferencia.");
    expect(finalStandingsFootnote([800, 780, 100])).toBe(
      "20 pts de diferencia. Fue una temporada muy pareja.",
    );
  });

  it("writes a single point in the singular", () => {
    expect(finalStandingsFootnote([799, 800])).toBe(
      "1 pt de diferencia. Fue una temporada muy pareja.",
    );
  });

  it("says so when the two are level", () => {
    expect(finalStandingsFootnote([500, 500])).toBe("Mismos puntos. Fue una temporada muy pareja.");
  });

  it("says so when nobody scored", () => {
    expect(finalStandingsFootnote([0, 0])).toBe("Nadie sumó puntos esta temporada");
  });
});

describe("stageLine", () => {
  it("joins the consistency and the closing automaticity", () => {
    expect(stageLine({ consistencyPercent: 88, automaticity: { from: "3,5", to: "5,8" } })).toBe(
      "Consistencia 88 % · automaticidad 5,8",
    );
  });

  it("drops what is not known", () => {
    expect(stageLine({ consistencyPercent: 50, automaticity: { from: null, to: null } })).toBe(
      "Consistencia 50 %",
    );
    expect(stageLine({ consistencyPercent: null, automaticity: { from: null, to: "2,8" } })).toBe(
      "Automaticidad 2,8",
    );
    expect(stageLine({ consistencyPercent: null, automaticity: { from: null, to: null } })).toBe(
      "",
    );
  });
});

describe("graduationLead", () => {
  it("counts the weeks and the consistency, then says the habit is part of the routine", () => {
    expect(graduationLead(8, 88)).toBe(
      "8 semanas, 88 % de consistencia y ya no necesitas llevar la cuenta. Ahora es parte de tu rutina.",
    );
  });

  it("keeps only the weeks when nothing was counted", () => {
    expect(graduationLead(6, null)).toBe(
      "6 semanas y ya no necesitas llevar la cuenta. Ahora es parte de tu rutina.",
    );
  });
});
