import { describe, expect, it } from "vitest";
import { CATEGORY_ICONS, HABIT_ICONS, iconFor } from "./icon-catalog.ts";

describe("habit icon catalog", () => {
  it("uses opaque persisted keys and falls back for missing or unknown keys", () => {
    expect(HABIT_ICONS).toHaveLength(20);
    expect(iconFor("book")).toBe("book-open");
    expect(iconFor("palette")).toBe("palette");
    expect([iconFor(null), iconFor("unknown"), iconFor("toString")]).toEqual([
      "flower-2",
      "flower-2",
      "flower-2",
    ]);
  });
  it("maps every design category to a catalog key", () => {
    expect(Object.keys(CATEGORY_ICONS)).toEqual([
      "Leer",
      "Movimiento",
      "Estudiar",
      "Dormir mejor",
      "Creatividad",
      "Finanzas",
      "Crear el mío",
    ]);
    for (const key of Object.values(CATEGORY_ICONS)) {
      expect(HABIT_ICONS.some((icon) => icon.key === key)).toBe(true);
    }
  });
  it("keeps the domain pause glyph out of the habit catalog", () => {
    expect(CATEGORY_ICONS["Dormir mejor"]).toBe("moon");
    expect(iconFor(CATEGORY_ICONS["Dormir mejor"])).toBe("moon");
    expect(HABIT_ICONS.map((icon) => icon.glyph)).not.toContain("circle-pause");
  });
});
