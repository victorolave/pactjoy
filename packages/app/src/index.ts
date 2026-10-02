/**
 * Public API of `@pactjoy/app` (`exports: "."` in `package.json`). Use
 * cases, queries and the domain/port types they need are added here as
 * each slice lands (ADR-0008). S1 exported only the shared kernel; S3
 * (circle-membership) adds the first concrete aggregate/repository and its
 * five use cases. Deterministic in-memory adapters for tests live under
 * the separate `./testing` subpath (`src/testing/index.ts`), never here.
 */

export { createCryptoRandomSource } from "./adapters/crypto-random-source.ts";
export { createIntlTimeZone } from "./adapters/intl-time-zone.ts";
export { createSystemClock } from "./adapters/system-clock.ts";
export { createUuidV7IdGenerator } from "./adapters/uuid-v7-id-generator.ts";
export type { CircleRepository } from "./circle/circle.repository.ts";
export type { Circle, Invite, Member } from "./circle/circle.ts";
export { memberId } from "./circle/circle.ts";
export type {
  CreateCircleDeps,
  CreateCircleError,
  CreateCircleInput,
} from "./circle/create-circle.ts";
export { createCircle } from "./circle/create-circle.ts";
export type {
  GenerateInviteDeps,
  GenerateInviteError,
  GenerateInviteInput,
} from "./circle/generate-invite.ts";
export { generateInvite } from "./circle/generate-invite.ts";
export type { InviteCode } from "./circle/invite-code.ts";
export { inviteCode, isInviteCodeFormat } from "./circle/invite-code.ts";
export type { JoinCircleDeps, JoinCircleError, JoinCircleInput } from "./circle/join-circle.ts";
export { joinCircle } from "./circle/join-circle.ts";
export type { LeaveCircleDeps, LeaveCircleError, LeaveCircleInput } from "./circle/leave-circle.ts";
export { leaveCircle } from "./circle/leave-circle.ts";
export type {
  RenameCircleDeps,
  RenameCircleError,
  RenameCircleInput,
} from "./circle/rename-circle.ts";
export { renameCircle } from "./circle/rename-circle.ts";
export type {
  RenameMyDisplayNameDeps,
  RenameMyDisplayNameError,
  RenameMyDisplayNameInput,
} from "./circle/rename-my-display-name.ts";
export { renameMyDisplayName } from "./circle/rename-my-display-name.ts";
export type { SeasonGateStatus } from "./circle/season-gate.ts";
export type {
  AddCommitmentDeps,
  AddCommitmentError,
  AddCommitmentInput,
} from "./commitment/add-commitment.ts";
export { addCommitment } from "./commitment/add-commitment.ts";
export type { CommitmentRecord, Measure, QuantityPrecision } from "./commitment/commitment.ts";
export { buildCommitment, commitmentId } from "./commitment/commitment.ts";
export type {
  EditCommitmentDeps,
  EditCommitmentError,
  EditCommitmentInput,
} from "./commitment/edit-commitment.ts";
export { editCommitment } from "./commitment/edit-commitment.ts";
export type {
  RemoveCommitmentDeps,
  RemoveCommitmentError,
  RemoveCommitmentInput,
} from "./commitment/remove-commitment.ts";
export { removeCommitment } from "./commitment/remove-commitment.ts";
export { commitmentToEngine } from "./commitment/to-engine.ts";
export type { MeasureInput, ValidateCommitmentError } from "./commitment/validate-commitment.ts";
export { validateCommitment } from "./commitment/validate-commitment.ts";
export type {
  DeleteEntryDeps,
  DeleteEntryError,
  DeleteEntryInput,
} from "./entry/delete-entry.ts";
export { deleteEntry } from "./entry/delete-entry.ts";
export type {
  EditEntryDeps,
  EditEntryError,
  EditEntryInput,
  EditEntryResult,
} from "./entry/edit-entry.ts";
export { editEntry } from "./entry/edit-entry.ts";
export type { EntryRepository } from "./entry/entry.repository.ts";
export type {
  EntryRecord,
  EntryTombstone,
  EntryValue,
  EntryValueInput,
  StoredEntry,
} from "./entry/entry.ts";
export type { EntryValueError } from "./entry/entry-value.ts";
export type { EntryWindowError } from "./entry/entry-window.ts";
export type {
  RecordEntryDeps,
  RecordEntryError,
  RecordEntryInput,
  RecordEntryResult,
} from "./entry/record-entry.ts";
export { recordEntry } from "./entry/record-entry.ts";
export type {
  CreateHabitDeps,
  CreateHabitError,
  CreateHabitInput,
} from "./habit/create-habit.ts";
export { createHabit } from "./habit/create-habit.ts";
export type { HabitRepository } from "./habit/habit.repository.ts";
export type { Habit } from "./habit/habit.ts";
export type {
  ApprovePactDeps,
  ApprovePactError,
  ApprovePactInput,
} from "./pact/approve-pact.ts";
export { approvePact } from "./pact/approve-pact.ts";
export type {
  WithdrawApprovalDeps,
  WithdrawApprovalError,
  WithdrawApprovalInput,
} from "./pact/withdraw-approval.ts";
export { withdrawApproval } from "./pact/withdraw-approval.ts";
export type { MemberPauseRequest, PauseRequestReader } from "./pause/pause-request.repository.ts";
export type { IdGenerator } from "./ports/id-generator.ts";
export type { RandomSource } from "./ports/random-source.ts";
export type { Repositories } from "./ports/repositories.ts";
export type { UnitOfWork } from "./ports/unit-of-work.ts";
export type { CommitmentScoreView, MeasureView } from "./score/commitment-projection.ts";
export type {
  MemberScoreDeps,
  MemberScoreError,
  MemberScoreInput,
  MemberScoreView,
} from "./score/member-score.query.ts";
export { memberScore } from "./score/member-score.query.ts";
export { canSeeDetail, visibleNote } from "./score/privacy.ts";
export type {
  StandingsDeps,
  StandingsError,
  StandingsInput,
  StandingsRowView,
  StandingsView,
} from "./score/standings.query.ts";
export { standings } from "./score/standings.query.ts";
export type {
  CreateSeasonDeps,
  CreateSeasonError,
  CreateSeasonInput,
} from "./season/create-season.ts";
export { createSeason } from "./season/create-season.ts";
export type {
  EditSeasonParamsDeps,
  EditSeasonParamsError,
  EditSeasonParamsInput,
} from "./season/edit-season-params.ts";
export { editSeasonParams } from "./season/edit-season-params.ts";
export type { SeasonRepository } from "./season/season.repository.ts";
export type {
  PactApproval,
  ReviewCadenceWeeks,
  Season,
  SeasonLengthWeeks,
  SeasonStatus,
} from "./season/season.ts";
export {
  isReviewCadenceWeeks,
  isSeasonLengthWeeks,
  reviewCadenceForLength,
} from "./season/season.ts";
export type {
  SeasonView,
  SeasonViewDeps,
  SeasonViewError,
  SeasonViewInput,
} from "./season/season-view.query.ts";
export { seasonView } from "./season/season-view.query.ts";
export type { Actor } from "./shared/actor.ts";
export { toDecimalString } from "./shared/decimal.ts";
export { ConcurrencyConflict, InviteCodeGenerationFailed } from "./shared/errors.ts";
export type { CircleId, EntryId, HabitId, SeasonId, UserId } from "./shared/ids.ts";
export { circleId, entryId, habitId, seasonId, userId } from "./shared/ids.ts";
export type { Result } from "./shared/result.ts";
export { err, ok } from "./shared/result.ts";
export type { Clock } from "./time/clock.port.ts";
export type { Instant } from "./time/instant.ts";
export { instant } from "./time/instant.ts";
export type { LocalDate } from "./time/local-date.ts";
export { localDate } from "./time/local-date.ts";
export type { SeasonDayResult } from "./time/season-calendar.ts";
export { localDateOfSeasonDay, toSeasonDay } from "./time/season-calendar.ts";
export type { TimeZone, TimeZoneId } from "./time/time-zone.port.ts";
export { timeZoneId } from "./time/time-zone.port.ts";
export type {
  TodayBase,
  TodayCircle,
  TodayDeps,
  TodaySeason,
  TodaySummary,
  TodayView,
} from "./today/today.query.ts";
export { today } from "./today/today.query.ts";
export type {
  OpportunityState,
  TodayEntry,
  TodayOpportunity,
  TodayRow,
  TodayWeekProgress,
} from "./today/today-rows.ts";
