import type {
  AddCommitmentError,
  ApprovePactError,
  CreateCircleError,
  CreateHabitError,
  CreateSeasonError,
  DeleteEntryError,
  EditCommitmentError,
  EditEntryError,
  EditSeasonParamsError,
  GenerateInviteError,
  JoinCircleError,
  LeaveCircleError,
  MemberScoreError,
  PreviewInviteError,
  RecordEntryError,
  RemoveCommitmentError,
  RenameCircleError,
  RenameMyDisplayNameError,
  SeasonViewError,
  StandingsError,
  UpdateHabitError,
  WithdrawApprovalError,
} from "@pactjoy/app";

/**
 * Every error a use case can return, from the 21 `*Error` unions the app exports. The
 * sub-unions (ValidateCommitmentError, EntryValueError, EntryWindowError) are already
 * members of these. A new use case must be added here (a boundary test scans the app index).
 */
export type AppError =
  | CreateCircleError
  | RenameCircleError
  | RenameMyDisplayNameError
  | GenerateInviteError
  | JoinCircleError
  | PreviewInviteError
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
  | StandingsError
  | SeasonViewError;

export type AppErrorKind = AppError["kind"];
