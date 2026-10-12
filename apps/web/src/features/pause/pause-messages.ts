import { ApiError } from "../../ports/api-error.ts";
import { toUiError } from "../../shared/ui-error.ts";

export interface PauseCapFailure {
  readonly commitmentId: string;
  readonly remainingDays: number;
}

export interface PauseFailure {
  readonly code: string;
  readonly message: string;
  /** Whether trying the same request again can help. */
  readonly retryable: boolean;
  /** `PauseCapExceeded`: the Commitments over their cap, with the days each one has left. */
  readonly capExceeded: readonly PauseCapFailure[];
  /** `PauseOverlaps`: the Commitments that already have a pause on those days. */
  readonly overlapping: readonly string[];
  /** The request was already decided: what the screen shows is stale and the card should go. */
  readonly settled: boolean;
}

const MESSAGES: Readonly<Record<string, string>> = {
  PauseCapExceeded: "Superas los días de pausa que te quedan.",
  PauseOverlaps: "Ya hay una pausa que se cruza con esas fechas.",
  PauseRetroactive: "La pausa no puede empezar en un día pasado.",
  PauseEndBeforeStart: "La fecha final no puede ser anterior al inicio.",
  PauseEndsAfterSeason: "La pausa no puede pasar del último día de la temporada.",
  SeasonNotActive: "La temporada no está activa.",
  NoteTooLong: "La nota es demasiado larga.",
  InvalidNote: "La nota es demasiado larga.",
  PauseAlreadyDecided: "Esta solicitud ya se decidió.",
  PauseNotPending: "Esta solicitud ya no está pendiente.",
  PauseNotActive: "Esta pausa ya no está en curso.",
  PauseRequestNotFound: "No encontramos esa solicitud.",
  ConcurrencyConflict: "Se actualizó en otro dispositivo. Inténtalo de nuevo.",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function capFailures(details: ApiError["details"]): PauseCapFailure[] {
  const items = details?.commitments;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item): PauseCapFailure[] =>
    isRecord(item) &&
    typeof item.commitmentId === "string" &&
    typeof item.remainingDays === "number"
      ? [{ commitmentId: item.commitmentId, remainingDays: item.remainingDays }]
      : [],
  );
}

function overlapIds(details: ApiError["details"]): string[] {
  const ids = details?.commitmentIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** Spanish copy for a failed pause request, answer, cancel or resume. */
export function pauseFailure(error: unknown): PauseFailure {
  const { retryable, code } = toUiError(error);
  const details = error instanceof ApiError ? error.details : undefined;
  const known = MESSAGES[code];
  return {
    code,
    message:
      known ??
      (retryable ? "No pudimos enviar la solicitud. Revisa tu conexión." : "Algo salió mal."),
    retryable: known === undefined && retryable,
    capExceeded: code === "PauseCapExceeded" ? capFailures(details) : [],
    overlapping: code === "PauseOverlaps" ? overlapIds(details) : [],
    settled: code === "PauseAlreadyDecided",
  };
}
