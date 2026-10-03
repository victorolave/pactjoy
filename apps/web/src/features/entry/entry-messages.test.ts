import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import { entryFailure } from "./entry-messages.ts";

const failure = (code: string) => entryFailure(new ApiError(code, 409, "req-1"));

describe("entryFailure", () => {
  it("makes a network or server failure retryable", () => {
    for (const code of ["NetworkError", "Internal", "ServiceUnavailable"]) {
      expect(failure(code)).toEqual({
        message: "No pudimos guardar el registro.",
        retryable: true,
      });
    }
  });

  it("explains a closed window and does not offer a retry (EN-R8)", () => {
    for (const code of ["WindowClosed", "FutureDay", "BeforeSeasonStart", "SeasonNotActive"]) {
      expect(failure(code)).toEqual({
        message: "Ya no se puede registrar este día.",
        retryable: false,
      });
    }
  });

  it("explains a vanished entry and a conflict", () => {
    expect(failure("EntryDeleted").message).toBe("Ese registro ya no existe.");
    expect(failure("EntryNotFound").message).toBe("Ese registro ya no existe.");
    expect(failure("ConcurrencyConflict").message).toBe("Se actualizó en otro dispositivo.");
  });

  it("says a commitment cannot be marked as missed (EN-R2)", () => {
    expect(failure("MissedNotAllowed")).toEqual({
      message: "Este compromiso no admite «Hoy no salió».",
      retryable: false,
    });
  });

  it("gives field errors their own message", () => {
    expect(failure("InvalidQuantity").message).toBe("La cantidad no es válida.");
    expect(failure("NoteTooLong").message).toBe("La nota es demasiado larga.");
  });

  it("falls back to a generic message for bugs and unknown failures", () => {
    expect(failure("InvalidRequest")).toEqual({ message: "Algo salió mal.", retryable: false });
    expect(entryFailure(new TypeError("x"))).toEqual({
      message: "Algo salió mal.",
      retryable: false,
    });
  });
});
