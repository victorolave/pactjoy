import type {
  AddCommitmentInput,
  CreateHabitInput,
  CreateSeasonInput,
  EditCommitmentInput,
  EditSeasonParamsInput,
  InvitePreview,
  MyCircleView,
  PreviewProgressInput,
  PreviewProgressView,
  TodayView,
  UpdateHabitInput,
} from "@pactjoy/app";
import type { HabitDto, SeasonDto, Serialized } from "./wire.ts";

export type CreateHabitCommand = Serialized<CreateHabitInput>;
export type UpdateHabitCommand = Omit<Serialized<UpdateHabitInput>, "habitId">;
export type CreateSeasonCommand = Omit<Serialized<CreateSeasonInput>, "circleId">;
export type EditSeasonCommand = Omit<Serialized<EditSeasonParamsInput>, "seasonId">;
export type AddCommitmentCommand = Omit<Serialized<AddCommitmentInput>, "seasonId">;
export type EditCommitmentCommand = Omit<
  Serialized<EditCommitmentInput>,
  "seasonId" | "commitmentId"
>;
export type PreviewScoringCommand = Serialized<PreviewProgressInput>;
export type ScoringPreview = Serialized<PreviewProgressView>;

export type EntryValueInput =
  | { readonly kind: "done" }
  | { readonly kind: "missed" }
  | { readonly kind: "quantity"; readonly value: string };

export interface RecordEntryCommand {
  readonly seasonId: string;
  readonly commitmentId: string;
  readonly forDate?: string;
  readonly value: EntryValueInput;
  readonly note: string | null;
  /** The idempotency key. Reuse it when retrying the same user action. */
  readonly clientRequestId: string;
}

export interface EditEntryCommand {
  readonly entryId: string;
  readonly value: EntryValueInput;
  readonly note: string | null;
}

/** A local wire type: the API returns the whole entry, the client needs only these two fields. */
export interface RecordedEntry {
  readonly entryId: string;
  readonly replayed: boolean;
}

/** The Circle tab's read model as it arrives over the wire (`GET /me/circle`). */
export type MyCircle = Serialized<MyCircleView>;
/** The circle's current invite; `expiresAt` is compared with the client clock, never trusted as a flag. */
export type CircleInvite = NonNullable<NonNullable<MyCircle["circle"]>["invite"]>;
/** What a code leads to, before joining (`POST /circles/join/preview`). */
export type InvitePreviewView = Serialized<InvitePreview>;

/** Create and join return the whole circle; the client keeps only the id and refetches `getMyCircle`. */
export interface CircleRef {
  readonly circleId: string;
}

export interface CreateCircleCommand {
  readonly name: string;
  readonly displayName: string;
}

export interface JoinCircleCommand {
  readonly inviteCode: string;
  readonly displayName: string;
}

/** Everything the screens know about the backend. Adapters throw `ApiError`. */
export interface PactJoyApi {
  listHabits(signal?: AbortSignal): Promise<readonly HabitDto[]>;
  createHabit(input: CreateHabitCommand): Promise<HabitDto>;
  updateHabit(id: string, patch: UpdateHabitCommand): Promise<HabitDto>;
  createSeason(circleId: string, input: CreateSeasonCommand): Promise<SeasonDto>;
  editSeason(seasonId: string, input: EditSeasonCommand): Promise<SeasonDto>;
  getSeason(seasonId: string, signal?: AbortSignal): Promise<SeasonDto>;
  addCommitment(seasonId: string, input: AddCommitmentCommand): Promise<SeasonDto>;
  editCommitment(
    seasonId: string,
    commitmentId: string,
    input: EditCommitmentCommand,
  ): Promise<SeasonDto>;
  removeCommitment(seasonId: string, commitmentId: string): Promise<SeasonDto>;
  approvePact(seasonId: string, expectedPactRevision: number): Promise<SeasonDto>;
  withdrawApproval(seasonId: string): Promise<SeasonDto>;
  previewScoring(input: PreviewScoringCommand, signal?: AbortSignal): Promise<ScoringPreview>;
  getToday(signal?: AbortSignal): Promise<TodayView>;
  recordEntry(cmd: RecordEntryCommand): Promise<RecordedEntry>;
  editEntry(cmd: EditEntryCommand): Promise<void>;
  deleteEntry(entryId: string): Promise<void>;
  getMyCircle(signal?: AbortSignal): Promise<MyCircle>;
  /** Read-only: the same errors as `joinCircle`, so a preview that works predicts the join. */
  previewInvite(inviteCode: string, signal?: AbortSignal): Promise<InvitePreviewView>;
  createCircle(cmd: CreateCircleCommand): Promise<CircleRef>;
  joinCircle(cmd: JoinCircleCommand): Promise<CircleRef>;
  generateInvite(circleId: string): Promise<CircleInvite>;
  renameCircle(circleId: string, name: string): Promise<void>;
  renameMyDisplayName(circleId: string, displayName: string): Promise<void>;
  leaveCircle(circleId: string): Promise<void>;
}
