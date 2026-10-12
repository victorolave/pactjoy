import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import { pauseFailure } from "./pause-messages.ts";

const fail = (code: string, details?: Record<string, unknown>, status = 409) =>
  pauseFailure(new ApiError(code, status, null, details));

describe("pause failures (screen 26 errors, PS-3)", () => {
  it("keeps the offending Commitments of PauseCapExceeded, with the days they have left", () => {
    const failure = fail("PauseCapExceeded", {
      commitments: [
        { commitmentId: "c-1", reason: "exceedsRemainingCap", remainingDays: 2 },
        { commitmentId: "c-2", reason: "capExhausted", remainingDays: 0 },
      ],
    });
    expect(failure.message).toBe("Superas los días de pausa que te quedan.");
    expect(failure.capExceeded).toEqual([
      { commitmentId: "c-1", remainingDays: 2 },
      { commitmentId: "c-2", remainingDays: 0 },
    ]);
  });

  it("ignores malformed cap details instead of crashing", () => {
    expect(fail("PauseCapExceeded", { commitments: "nope" }).capExceeded).toEqual([]);
    expect(fail("PauseCapExceeded").capExceeded).toEqual([]);
  });

  it("keeps the overlapping Commitments of PauseOverlaps", () => {
    const failure = fail("PauseOverlaps", { commitmentIds: ["c-1"] });
    expect(failure.message).toBe("Ya hay una pausa que se cruza con esas fechas.");
    expect(failure.overlapping).toEqual(["c-1"]);
  });

  it.each([
    ["PauseRetroactive", "La pausa no puede empezar en un día pasado.", 422],
    ["PauseEndBeforeStart", "La fecha final no puede ser anterior al inicio.", 422],
    ["PauseEndsAfterSeason", "La pausa no puede pasar del último día de la temporada.", 422],
    ["SeasonNotActive", "La temporada no está activa.", 409],
    ["NoteTooLong", "La nota es demasiado larga.", 422],
    ["PauseAlreadyDecided", "Esta solicitud ya se decidió.", 409],
    ["PauseNotPending", "Esta solicitud ya no está pendiente.", 409],
    ["PauseNotActive", "Esta pausa ya no está en curso.", 409],
    ["PauseRequestNotFound", "No encontramos esa solicitud.", 404],
    ["ConcurrencyConflict", "Se actualizó en otro dispositivo. Inténtalo de nuevo.", 409],
  ])("%s -> %s", (code, message, status) => {
    const failure = fail(code, undefined, status);
    expect(failure.message).toBe(message);
    expect(failure.retryable).toBe(false);
  });

  it("marks a lost connection as retryable", () => {
    const failure = pauseFailure(new ApiError("NetworkError", 0, null));
    expect(failure.retryable).toBe(true);
    expect(failure.message).toBe("No pudimos enviar la solicitud. Revisa tu conexión.");
  });

  it("falls back to a generic message for anything else", () => {
    expect(fail("Surprise").message).toBe("Algo salió mal.");
    expect(pauseFailure(new Error("x")).message).toBe("Algo salió mal.");
  });

  it("says a decided request is final only for PauseAlreadyDecided (so the card can drop away)", () => {
    expect(fail("PauseAlreadyDecided").settled).toBe(true);
    expect(fail("PauseOverlaps").settled).toBe(false);
  });
});
