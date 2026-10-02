import type { ApiResult } from "../http/types.ts";
import type { AppError, AppErrorKind } from "./app-error.ts";

/**
 * The single status table (provisional under open question Q7). `satisfies` makes a missing
 * kind AND an extra stale key a compile error.
 */
export const APP_ERROR_STATUS = {
  // 422 (34)
  CategoryTooLong: 422,
  CustomLabelBlank: 422,
  CustomLabelHasInvisibleCharacters: 422,
  CustomLabelMalformed: 422,
  CustomLabelTooLong: 422,
  DuplicateWeekday: 422,
  IdealExceedsTolerance: 422,
  IdempotencyKeyReused: 422,
  IntegerRequired: 422,
  InvalidCategory: 422,
  InvalidClientRequestId: 422,
  InvalidDisplayName: 422,
  InvalidLengthWeeks: 422,
  InvalidName: 422,
  InvalidNote: 422,
  InvalidPrecision: 422,
  InvalidQuantity: 422,
  InvalidReviewCadenceWeeks: 422,
  InvalidStartDate: 422,
  InvalidTimesPerWeek: 422,
  InvalidTimezone: 422,
  InvalidWeekday: 422,
  InvalidWeight: 422,
  InvalidWhy: 422,
  MinimumExceedsIdeal: 422,
  MinimumNotPositive: 422,
  MissedNotAllowed: 422,
  NoWeekdays: 422,
  NoteTooLong: 422,
  OutsideSeason: 422,
  PrecisionNotApplicable: 422,
  StartDateInPast: 422,
  StartDateTooFarAhead: 422,
  ValueKindMismatch: 422,
  // 403 (4)
  CommitmentNotOwned: 403,
  EntryNotOwned: 403,
  NotAMember: 403,
  NotOwner: 403,
  // 404 (6)
  CircleNotFound: 404,
  CommitmentNotFound: 404,
  EntryNotFound: 404,
  InviteNotFound: 404,
  MemberNotFound: 404,
  SeasonNotFound: 404,
  // 409 (14)
  AlreadyInActiveCircle: 409,
  BeforeSeasonStart: 409,
  CircleArchived: 409,
  CircleFull: 409,
  CommitmentWeightsNotFull: 409,
  EntryDeleted: 409,
  FutureDay: 409,
  PactAlreadyClosed: 409,
  PactNotOpen: 409,
  SeasonInProgress: 409,
  SeasonNotActive: 409,
  SeasonNotJoinable: 409,
  StaleSeason: 409,
  WindowClosed: 409,
  // 410 (1)
  InviteExpired: 410,
} as const satisfies Record<AppErrorKind, 403 | 404 | 409 | 410 | 422>;

/**
 * The app error as an API result. `details` is the app error minus `kind`, when it has any
 * (e.g. `{reason}` or `{field}`): the app's errors carry only small enums and field names.
 */
export function appErrorResult(error: AppError): ApiResult {
  const { kind, ...rest } = error as { kind: AppErrorKind } & Record<string, unknown>;
  return {
    status: APP_ERROR_STATUS[kind],
    error: {
      code: kind,
      message: kind,
      ...(Object.keys(rest).length > 0 ? { details: rest } : {}),
    },
  };
}
