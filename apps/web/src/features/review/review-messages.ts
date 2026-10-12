import { ApiError } from "../../ports/api-error.ts";
import { toUiError } from "../../shared/ui-error.ts";

/**
 * What a failed review call means for the screen (ADR-0014, ADR-0011 Q21):
 * - `notDue`: not available yet, or the season is not running: go back to Today.
 * - `lapsed`: the window closed: go back to Today.
 * - `alreadySubmitted`: nothing to redo; refetch and show it saved. A lost race (409) is the same.
 * - `notFound`: that period does not exist (or cannot be skipped).
 * - `answers`: some answer is missing or invalid: back to the questions.
 * - `reflection`: a reflection field is too long or invalid; `field` says which one.
 * - `retry`: the network failed; trying again can help.
 */
export type ReviewFailureKind =
  | "notDue"
  | "lapsed"
  | "alreadySubmitted"
  | "notFound"
  | "answers"
  | "reflection"
  | "retry"
  | "generic";

export interface ReviewFailure {
  readonly kind: ReviewFailureKind;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  /** `reflection` only: which text field the server pointed at. */
  readonly field: "helped" | "hard" | null;
}

const make = (
  kind: ReviewFailureKind,
  code: string,
  message: string,
  extra: Partial<Pick<ReviewFailure, "retryable" | "field">> = {},
): ReviewFailure => ({ kind, code, message, retryable: false, field: null, ...extra });

const fieldOf = (error: ApiError): "helped" | "hard" | null => {
  const field = error.details?.field;
  return field === "helped" || field === "hard" ? field : null;
};

export function reviewFailure(error: unknown): ReviewFailure {
  if (!(error instanceof ApiError)) return make("generic", "Unknown", "Algo salió mal.");
  const { code } = error;
  switch (code) {
    case "ReviewNotDue":
      return error.details?.reason === "lapsed"
        ? make("lapsed", code, "Esta revisión ya pasó. La próxima te llegará a su hora.")
        : make("notDue", code, "Esta revisión todavía no está disponible.");
    case "SeasonNotActive":
      return make("notDue", code, "La temporada no está activa.");
    case "ReviewAlreadySubmitted":
    case "ConcurrencyConflict":
      return make("alreadySubmitted", code, "Esta revisión ya está guardada.");
    case "ReviewPeriodNotFound":
    case "ReviewNotSkippable":
      return make("notFound", code, "No encontramos esta revisión.");
    case "AutomaticityIncomplete":
    case "InvalidAutomaticity":
      return make("answers", code, "Falta responder alguna frase. Revisa tus respuestas.");
    case "NoteTooLong":
    case "InvalidNote":
      return make("reflection", code, "Es demasiado largo. Acórtalo un poco.", {
        field: fieldOf(error),
      });
    default:
      return toUiError(error).retryable
        ? make("retry", code, "No pudimos guardar tu revisión. Revisa tu conexión.", {
            retryable: true,
          })
        : make("generic", code, "Algo salió mal.");
  }
}

export interface LoadFailure {
  readonly message: string;
  readonly retryable: boolean;
}

/** Copy for a draft that could not be read (`GET /seasons/:id/reviews/:k`). */
export function loadFailure(error: unknown): LoadFailure {
  const failure = reviewFailure(error);
  if (failure.kind === "retry") {
    return { message: "No pudimos cargar tu revisión. Revisa tu conexión.", retryable: true };
  }
  if (failure.kind === "notFound" || (error instanceof ApiError && error.code === "NotAMember")) {
    return { message: "No encontramos esta revisión.", retryable: false };
  }
  return { message: failure.message, retryable: false };
}
