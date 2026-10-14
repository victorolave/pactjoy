import type { ApiResult } from "../http/types.ts";
import type { AppError, AppErrorKind } from "./app-error.ts";

/**
 * The single status table (provisional under open question Q7). `satisfies` makes a missing
 * kind AND an extra stale key a compile error.
 */
export const APP_ERROR_STATUS = {
  // 422 (47)
  AutomaticityIncomplete: 422,
  CategoryTooLong: 422,
  ClosureIncomplete: 422,
  CustomLabelBlank: 422,
  CustomLabelHasInvisibleCharacters: 422,
  CustomLabelMalformed: 422,
  CustomLabelTooLong: 422,
  DuplicateWeekday: 422,
  IdealExceedsTolerance: 422,
  IdempotencyKeyReused: 422,
  IntegerRequired: 422,
  InvalidCategory: 422,
  InvalidAutomaticity: 422,
  InvalidClientRequestId: 422,
  InvalidClosureDecision: 422,
  InvalidDisplayName: 422,
  InvalidIcon: 422,
  InvalidLengthWeeks: 422,
  InvalidName: 422,
  InvalidPauseReason: 422,
  InvalidPhoto: 422,
  PhotoNotAllowedOnMissed: 422,
  InvalidPauseScope: 422,
  InvalidPreviewValues: 422,
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
  PauseEndBeforeStart: 422,
  PauseEndsAfterSeason: 422,
  PauseRetroactive: 422,
  PrecisionNotApplicable: 422,
  StartDateInPast: 422,
  StartDateTooFarAhead: 422,
  ValueKindMismatch: 422,
  // 403 (6)
  CannotRespondToOwnPause: 403,
  CommitmentNotOwned: 403,
  EntryNotOwned: 403,
  NotAMember: 403,
  NotOwner: 403,
  NotPauseRequester: 403,
  // 404 (10)
  CircleNotFound: 404,
  CommitmentNotFound: 404,
  EntryNotFound: 404,
  HabitNotFound: 404,
  InviteNotFound: 404,
  MemberNotFound: 404,
  PauseRequestNotFound: 404,
  PhotoNotFound: 404,
  ReviewPeriodNotFound: 404,
  SeasonNotFound: 404,
  // 409 (34)
  AlreadyInActiveCircle: 409,
  BeforeSeasonStart: 409,
  CircleArchived: 409,
  CircleFull: 409,
  ClosingReviewRequired: 409,
  ClosureAlreadySubmitted: 409,
  CommitmentWeightsNotFull: 409,
  DisplayNameTaken: 409,
  EntryDeleted: 409,
  FutureDay: 409,
  NothingToClose: 409,
  OpportunityOnHold: 409,
  OpportunityPaused: 409,
  PactAlreadyClosed: 409,
  PactNotOpen: 409,
  HabitGraduated: 409,
  PauseAlreadyDecided: 409,
  PauseCapExceeded: 409,
  PauseNotActive: 409,
  PauseNotPending: 409,
  PauseOverlaps: 409,
  PhotoNotAvailable: 409,
  PhotoNotUploaded: 409,
  PhotoUploadExpired: 409,
  ReviewAlreadySubmitted: 409,
  ReviewNotDue: 409,
  ReviewNotSkippable: 409,
  SeasonInProgress: 409,
  SeasonNotActive: 409,
  SeasonNotJoinable: 409,
  SeasonResultsNotYet: 409,
  StaleSeason: 409,
  TooManyPhotoUploads: 409,
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
