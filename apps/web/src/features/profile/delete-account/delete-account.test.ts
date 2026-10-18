import { describe, expect, it } from "vitest";
import { canConfirm } from "./delete-account.ts";

describe("canConfirm (the typed word, ADR-0019)", () => {
  it.each(["ELIMINAR", "ELIMINAR ", "  ELIMINAR", "\tELIMINAR\n"])(
    "accepts %j: the word exactly, around any whitespace",
    (text) => {
      expect(canConfirm(text)).toBe(true);
    },
  );

  it.each(["", "   ", "eliminar", "Eliminar", "ELIMINA", "ELIMINAR cuenta", "ELIMI NAR"])(
    "rejects %j",
    (text) => {
      expect(canConfirm(text)).toBe(false);
    },
  );
});
