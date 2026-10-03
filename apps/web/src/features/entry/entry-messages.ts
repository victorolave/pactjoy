import { toUiError } from "../../shared/ui-error.ts";

export interface EntryFailure {
  readonly message: string;
  /** Whether trying the same request again can help. */
  readonly retryable: boolean;
}

/** Placeholder Spanish copy (P8): the design has no wording for these failures yet. */
export function entryFailure(error: unknown, verb: "guardar" | "borrar" = "guardar"): EntryFailure {
  const { kind, code, retryable } = toUiError(error);
  switch (kind) {
    case "retryable":
      return { message: `No pudimos ${verb} el registro.`, retryable };
    case "closedWindow":
      return { message: "Ya no se puede registrar este día.", retryable };
    case "entryGone":
      return { message: "Ese registro ya no existe.", retryable };
    case "conflict":
      return { message: "Se actualizó en otro dispositivo.", retryable };
    case "quantityField":
      return { message: "La cantidad no es válida.", retryable };
    case "noteField":
      return { message: "La nota es demasiado larga.", retryable };
    case "generic":
      return { message: `No pudimos ${verb} el registro.`, retryable };
    default:
      return code === "MissedNotAllowed"
        ? { message: "Este compromiso no admite «Hoy no salió».", retryable }
        : { message: "Algo salió mal.", retryable };
  }
}
