import type {
  AddCommitmentError,
  ApprovePactError,
  CancelPauseRequestError,
  CarryOverError,
  CircleFeedError,
  CommitmentProgressError,
  CommitmentReminderError,
  CommitmentStageError,
  CreateCircleError,
  CreateHabitError,
  CreateSeasonError,
  DeleteAccountError,
  DeleteEntryError,
  DismissNudgeError,
  EditCommitmentError,
  EditEntryError,
  EditSeasonParamsError,
  GenerateInviteError,
  JoinCircleError,
  LeaveCircleError,
  MemberProgressError,
  MemberScoreError,
  PreviewInviteError,
  PreviewProgressError,
  PushSubscriptionError,
  ReactionError,
  RecordEntryError,
  RemoveCommitmentError,
  RemoveFeedReactionError,
  RenameCircleError,
  RenameMyDisplayNameError,
  RequestEntryPhotoUploadError,
  RequestPauseError,
  RespondToPauseError,
  ResumePauseError,
  ReviewDraftError,
  SeasonProgressError,
  SeasonResultsError,
  SeasonViewError,
  SendEncouragementError,
  SetCommitmentReminderError,
  SkipBaselineError,
  StandingsError,
  SubmitReviewError,
  SubmitSeasonClosureError,
  UpdateHabitError,
  WeekSummaryError,
  WithdrawApprovalError,
} from "@pactjoy/app";

/**
 * Every error a use case can return, from the app's exported `*Error` unions. The
 * sub-unions (ValidateCommitmentError, EntryValueError, EntryWindowError) are already
 * members of these. A new use case must be added here (a boundary test scans the app index).
 */
export type AppError =
  | CreateCircleError
  | RenameCircleError
  | RenameMyDisplayNameError
  | RequestEntryPhotoUploadError
  | GenerateInviteError
  | JoinCircleError
  | PreviewInviteError
  | PreviewProgressError
  | LeaveCircleError
  | CreateHabitError
  | UpdateHabitError
  | CreateSeasonError
  | EditSeasonParamsError
  | AddCommitmentError
  | EditCommitmentError
  | RemoveCommitmentError
  | ApprovePactError
  | WithdrawApprovalError
  | RecordEntryError
  | EditEntryError
  | DeleteEntryError
  | MemberScoreError
  | MemberProgressError
  | CommitmentProgressError
  | StandingsError
  | SeasonProgressError
  | WeekSummaryError
  | SeasonViewError
  | RequestPauseError
  | RespondToPauseError
  | CancelPauseRequestError
  | ResumePauseError
  | SubmitReviewError
  | SkipBaselineError
  | ReviewDraftError
  | CommitmentStageError
  | SubmitSeasonClosureError
  | SeasonResultsError
  | CarryOverError
  | CircleFeedError
  | ReactionError
  | RemoveFeedReactionError
  | SendEncouragementError
  | DismissNudgeError
  | PushSubscriptionError
  | CommitmentReminderError
  | SetCommitmentReminderError
  | DeleteAccountError;

export type AppErrorKind = AppError["kind"];
