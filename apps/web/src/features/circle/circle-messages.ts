import type {
  CreateCircleError,
  GenerateInviteError,
  JoinCircleError,
  LeaveCircleError,
  PreviewInviteError,
  RenameCircleError,
  RenameMyDisplayNameError,
} from "@pactjoy/app";
import { ApiError } from "../../ports/api-error.ts";

type AppKind = (
  | CreateCircleError
  | GenerateInviteError
  | JoinCircleError
  | LeaveCircleError
  | PreviewInviteError
  | RenameCircleError
  | RenameMyDisplayNameError
)["kind"];

/** Codes the API or the client adds itself (see `ui-error.ts`). */
type TransportKind =
  | "NetworkError"
  | "ServiceUnavailable"
  | "Internal"
  | "Unauthorized"
  | "ConcurrencyConflict"
  | "CircleNotFound";

/** Which input an error belongs under; `null` means a message for the whole form or screen. */
export type CircleField = "name" | "displayName" | "code" | null;

export interface CircleFailure {
  readonly message: string;
  readonly field: CircleField;
  /** Whether trying the same request again can help. */
  readonly retryable: boolean;
}

const GENERIC: CircleFailure = { message: "Algo salió mal.", field: null, retryable: false };
const RETRY: CircleFailure = {
  message: "No pudimos completar la acción. Inténtalo de nuevo.",
  field: null,
  retryable: true,
};

/**
 * `AlreadyInActiveCircle` when the code is the viewer's own circle's (the join screen compares it
 * against `myCircle`): not a failure to fix, so it has its own wording.
 */
export const ALREADY_IN_THIS_CIRCLE = "Ya formas parte de este círculo.";

/** Under the code boxes when typed or pasted characters were dropped for not being in the alphabet. */
export const CODE_CHARS_HINT = "Los códigos no usan 0, O, 1, I ni L.";

/** `satisfies` makes a missing or stale code a compile error; the test walks every key. */
export const CIRCLE_FAILURES = {
  InvalidName: {
    message: "Ponle un nombre al círculo (hasta 40 caracteres).",
    field: "name",
    retryable: false,
  },
  InvalidDisplayName: {
    message: "Tu nombre debe tener entre 1 y 30 caracteres.",
    field: "displayName",
    retryable: false,
  },
  DisplayNameTaken: {
    message: "Ese nombre ya lo usa alguien del círculo. Elige otro.",
    field: "displayName",
    retryable: false,
  },
  InviteNotFound: {
    message: "No encontramos ese código. Revísalo o pide uno nuevo.",
    field: "code",
    retryable: false,
  },
  InviteExpired: {
    message: "Ese código venció. Pídele a alguien del círculo uno nuevo.",
    field: "code",
    retryable: false,
  },
  CircleFull: { message: "Ese círculo ya tiene 6 personas.", field: "code", retryable: false },
  SeasonNotJoinable: {
    message: "Ese círculo ya tiene una temporada en marcha. Podrás unirte cuando termine.",
    field: "code",
    retryable: false,
  },
  CircleArchived: { message: "Ese círculo ya no está activo.", field: "code", retryable: false },
  AlreadyInActiveCircle: {
    message: "Ya formas parte de un círculo. Sal de él antes de unirte a otro.",
    field: null,
    retryable: false,
  },
  NotAMember: { message: "Ya no formas parte de este círculo.", field: null, retryable: false },
  CircleNotFound: { message: "Ese círculo ya no existe.", field: null, retryable: false },
  ConcurrencyConflict: {
    message: "Se actualizó en otro dispositivo. Inténtalo de nuevo.",
    field: null,
    retryable: true,
  },
  NetworkError: {
    message: "Sin conexión. Revisa tu internet e inténtalo de nuevo.",
    field: null,
    retryable: true,
  },
  ServiceUnavailable: RETRY,
  Internal: RETRY,
  Unauthorized: GENERIC,
} as const satisfies Record<AppKind | TransportKind, CircleFailure>;

/** Spanish copy for a failed circle request; anything unknown is the generic message. */
export function circleFailure(error: unknown): CircleFailure {
  if (!(error instanceof ApiError)) return GENERIC;
  return Object.hasOwn(CIRCLE_FAILURES, error.code)
    ? CIRCLE_FAILURES[error.code as keyof typeof CIRCLE_FAILURES]
    : GENERIC;
}
