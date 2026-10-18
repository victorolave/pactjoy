import { toUiError } from "../../shared/ui-error.ts";

export interface EntryFailure {
  readonly message: string;
  /** Whether trying the same request again can help. */
  readonly retryable: boolean;
}

/** What the member is told when a write was kept on the phone to be sent later (OE-R8). */
export const QUEUED_SAVED = "Guardado en este teléfono. Se enviará al volver la conexión.";
export const QUEUED_MISSED = "Anotado en este teléfono: hoy no salió.";
export const QUEUED_MISSED_YESTERDAY = "Anotado en este teléfono: ayer no salió.";
export const QUEUED_UNDONE =
  "Registro deshecho en este teléfono. Se enviará al volver la conexión.";
/** The line in a sheet while there is no connection: the save goes to the phone, not the server. */
export const OFFLINE_SAVE_LINE = "Sin conexión: se guardará en este teléfono.";
export const QUEUED_DELETED =
  "Registro borrado en este teléfono. Se enviará al volver la conexión.";

/** Placeholder Spanish copy (P8): the design has no wording for these failures yet. */
export function entryFailure(error: unknown, verb: "guardar" | "borrar" = "guardar"): EntryFailure {
  const { kind, code, retryable } = toUiError(error);
  switch (kind) {
    case "retryable":
      return { message: `No pudimos ${verb} el registro.`, retryable };
    case "closedWindow":
      return { message: "Ya no se puede registrar este día.", retryable };
    case "paused":
      return { message: "Este compromiso está en pausa. Reanúdalo para registrar.", retryable };
    case "onHold":
      return {
        message: "Este compromiso está en espera: tu solicitud de pausa aún no tiene respuesta.",
        retryable,
      };
    case "entryGone":
      return { message: "Ese registro ya no existe.", retryable };
    case "conflict":
      return { message: "Se actualizó en otro dispositivo.", retryable };
    case "quantityField":
      return { message: "La cantidad no es válida.", retryable };
    case "noteField":
      return { message: "La nota es demasiado larga.", retryable };
    case "photo":
      return { message: "No pudimos usar la foto.", retryable };
    case "photoLimit":
      return {
        message: "Tienes demasiadas fotos pendientes. Inténtalo en unos minutos.",
        retryable,
      };
    case "generic":
      return { message: `No pudimos ${verb} el registro.`, retryable };
    default:
      return code === "MissedNotAllowed"
        ? { message: "Este compromiso no admite «Hoy no salió».", retryable }
        : { message: "Algo salió mal.", retryable };
  }
}
