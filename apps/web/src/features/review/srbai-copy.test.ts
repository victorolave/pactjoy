import { describe, expect, it } from "vitest";
import {
  ITEM_ONE_SCALE_HINT,
  PRIVATE_NOTE,
  SRBAI_ITEMS,
  SRBAI_SCALE,
  srbaiPhrase,
} from "./srbai-copy.ts";

describe("SRBAI copy (design 13, 35a, 35c)", () => {
  it("has the four phrases of the design, each naming the habit", () => {
    expect(SRBAI_ITEMS).toBe(4);
    expect([0, 1, 2, 3].map((item) => srbaiPhrase("Leer", item as 0 | 1 | 2 | 3))).toEqual([
      "«Leer»: lo hago automáticamente.",
      "«Leer»: lo hago sin tener que recordarlo conscientemente.",
      "«Leer»: lo hago sin pensar.",
      "«Leer»: empiezo a hacerlo antes de darme cuenta.",
    ]);
  });

  it("uses the habit as given, so another habit gets its own phrases", () => {
    expect(srbaiPhrase("Dibujar", 2)).toBe("«Dibujar»: lo hago sin pensar.");
  });

  it("scales 1 to 7 with the two end labels and says the answers are private", () => {
    expect(SRBAI_SCALE).toEqual({
      min: 1,
      max: 7,
      low: "1 · Nada de acuerdo",
      high: "7 · Totalmente",
    });
    expect(ITEM_ONE_SCALE_HINT).toBe("1 · nada de acuerdo — 7 · totalmente");
    expect(PRIVATE_NOTE).toBe("Solo tú verás estas respuestas.");
  });
});
