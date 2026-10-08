import type {
  AddCommitmentError,
  ApprovePactError,
  CommitmentProgressError,
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
  MemberProgressError,
  MemberScoreError,
  PreviewInviteError,
  PreviewProgressError,
  RecordEntryError,
  RemoveCommitmentError,
  RenameCircleError,
  RenameMyDisplayNameError,
  SeasonProgressError,
  SeasonViewError,
  StandingsError,
  UpdateHabitError,
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
  | SeasonViewError;

export type AppErrorKind = AppError["kind"];
