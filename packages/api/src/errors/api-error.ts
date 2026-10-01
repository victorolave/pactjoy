import type { ApiResult } from "../http/types.ts";
import type { AppErrorKind } from "./app-error.ts";

/** Error kinds the API itself produces (never returned by a use case). */
export const API_ERROR_STATUS = {
  InvalidJson: 400,
  Unauthorized: 401,
  RouteNotFound: 404,
  MethodNotAllowed: 405,
  ConcurrencyConflict: 409,
  PayloadTooLarge: 413,
  UnsupportedMediaType: 415,
  InvalidRequest: 422,
  InviteCodeGenerationFailed: 500,
  Internal: 500,
  ServiceUnavailable: 503,
} as const;

export type ApiErrorKind = keyof typeof API_ERROR_STATUS;

// Compile-time: the API's kinds and the app's kinds never overlap.
const _disjoint: [Extract<ApiErrorKind, AppErrorKind>] extends [never] ? true : never = true;
void _disjoint;

export const apiFailure = (
  kind: ApiErrorKind,
  details?: Readonly<Record<string, unknown>>,
  headers?: Readonly<Record<string, string>>,
): ApiResult => ({
  status: API_ERROR_STATUS[kind],
  error: { code: kind, message: kind, ...(details ? { details } : {}) },
  ...(headers ? { headers } : {}),
});
