import type { DeleteEntryError, EditEntryError, RecordEntryError } from "@pactjoy/app";
import { ApiError } from "../ports/api-error.ts";

/** Codes the use cases return for entries (type-only import: erased at build time). */
type AppCode =
  | RecordEntryError["kind"]
  | EditEntryError["kind"]
  | DeleteEntryError["kind"]
  // Returned by the API for entries but not part of those unions.
  | "CommitmentNotFound";

/** Codes the API or the client adds itself. */
type TransportCode =
  | "Unauthorized"
  | "NetworkError"
  | "Internal"
  | "ServiceUnavailable"
  | "ConcurrencyConflict"
  | "InvalidRequest"
  | "InvalidJson"
  | "RouteNotFound"
  | "MethodNotAllowed";

export type KnownCode = AppCode | TransportCode;

/** What the UI should do about a failure. Copy lives with the screens, not here. */
export type UiKind =
  | "sessionExpired"
  | "retryable"
  | "closedWindow"
  | "entryGone"
  | "conflict"
  | "quantityField"
  | "noteField"
  | "generic"
  | "bug";

/** `satisfies` makes a missing or stale code a compile error. */
export const UI_KIND_BY_CODE = {
  Unauthorized: "sessionExpired",
  NetworkError: "retryable",
  Internal: "retryable",
  ServiceUnavailable: "retryable",
  WindowClosed: "closedWindow",
  SeasonNotActive: "closedWindow",
  BeforeSeasonStart: "closedWindow",
  FutureDay: "closedWindow",
  OutsideSeason: "closedWindow",
  EntryDeleted: "entryGone",
  EntryNotFound: "entryGone",
  ConcurrencyConflict: "conflict",
  InvalidQuantity: "quantityField",
  NoteTooLong: "noteField",
  InvalidNote: "noteField",
  NotAMember: "generic",
  EntryNotOwned: "generic",
  CommitmentNotOwned: "generic",
  CommitmentNotFound: "generic",
  SeasonNotFound: "generic",
  MissedNotAllowed: "bug",
  ValueKindMismatch: "bug",
  IdempotencyKeyReused: "bug",
  InvalidClientRequestId: "bug",
  InvalidRequest: "bug",
  InvalidJson: "bug",
  RouteNotFound: "bug",
  MethodNotAllowed: "bug",
} as const satisfies Record<KnownCode, UiKind>;

/** Kinds after which what the screen shows may be stale: Today is refetched. */
const INVALIDATES_TODAY: ReadonlySet<UiKind> = new Set([
  "closedWindow",
  "entryGone",
  "conflict",
  "generic",
]);

export interface UiError {
  readonly kind: UiKind;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly invalidateToday: boolean;
}

const isKnownCode = (code: string): code is KnownCode => Object.hasOwn(UI_KIND_BY_CODE, code);

export function toUiError(error: unknown): UiError {
  if (!(error instanceof ApiError)) {
    return {
      kind: "bug",
      code: "Unknown",
      requestId: null,
      retryable: false,
      invalidateToday: false,
    };
  }
  const kind: UiKind = isKnownCode(error.code) ? UI_KIND_BY_CODE[error.code] : "bug";
  return {
    kind,
    code: error.code,
    requestId: error.requestId,
    retryable: kind === "retryable",
    invalidateToday: INVALIDATES_TODAY.has(kind),
  };
}
