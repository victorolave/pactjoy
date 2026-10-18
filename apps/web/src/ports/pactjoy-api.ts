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
import type { DevicePushSubscription } from "./push-subscription.ts";
import type { SeasonProgressApi } from "./season-progress-api.ts";
import type {
  CarryOverDto,
  CircleFeedDto,
  ClosureDecisionEntryDto,
  CommitmentStageDto,
  HabitDto,
  MyPauseRequests,
  PauseApprovalDto,
  PauseRequestDto,
  PhotoUploadDto,
  ProfileSummaryDto,
  ReactionCode,
  ReactionsDto,
  ReviewDraftDto,
  SeasonDto,
  SeasonHistoryDto,
  SeasonResultsDto,
  Serialized,
  SubmittedClosureDto,
  SubmittedReviewDto,
} from "./wire.ts";

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
  /** A photo already uploaded to its reserved slot (`requestPhotoUpload`); omitted or null for none. */
  readonly photoId?: string | null;
  /** The idempotency key. Reuse it when retrying the same user action. */
  readonly clientRequestId: string;
}

export interface EditEntryCommand {
  readonly entryId: string;
  readonly value: EntryValueInput;
  readonly note: string | null;
  /**
   * Omitted keeps the entry's photo (also what an old cached client does), `null` removes it and a
   * new id replaces it.
   */
  readonly photoId?: string | null;
}

/** What the client says about the file it is about to upload; the signature pins both. */
export interface RequestPhotoUploadCommand {
  readonly seasonId: string;
  readonly commitmentId: string;
  readonly byteSize: number;
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

/** Why a member asks for a Pause. The closed list is the app's; the Spanish labels live in the UI. */
export type PauseReasonCode = PauseRequestDto["reason"];

export interface RequestPauseCommand {
  readonly scope:
    | { readonly kind: "all" }
    | { readonly kind: "commitment"; readonly commitmentId: string };
  readonly reason: PauseReasonCode;
  readonly note: string | null;
  /** The first paused day; never in the past. */
  readonly startDate: string;
  /** The last paused day, or `null` for an open pause ("until I resume"). */
  readonly endDate: string | null;
}

export type PauseDecision = "approve" | "reject";

/**
 * One commitment's SRBAI answers: always four slots. A full review fills all of them; item 1 only
 * fills the first and leaves the rest `null` (the server rejects anything else, ADR-0014).
 */
export interface ReviewAnswer {
  readonly commitmentId: string;
  readonly items: readonly [number | null, number | null, number | null, number | null];
}

export interface SubmitReviewCommand {
  /** Both fields are always sent; `null` is "nothing written". */
  readonly reflection: { readonly helped: string | null; readonly hard: string | null };
  readonly automaticity: readonly ReviewAnswer[];
}

/** One decision per commitment of the member: the client sends them all at once, exactly once. */
export interface SubmitClosureCommand {
  readonly decisions: readonly ClosureDecisionEntryDto[];
}

export interface SendEncouragementCommand {
  readonly recipientId: string;
  /** The nudge's 1-based case week. */
  readonly week: number;
  readonly emoji: ReactionCode;
}

export interface DismissNudgeCommand {
  readonly targetId: string;
  readonly week: number;
}

/** Everything the screens know about the backend. Adapters throw `ApiError`. */
export interface PactJoyApi extends SeasonProgressApi {
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
  /** Reserves a slot for one JPEG of `byteSize` bytes and signs the PUT that fills it (ADR-0016). */
  requestPhotoUpload(cmd: RequestPhotoUploadCommand): Promise<PhotoUploadDto>;
  getMyCircle(signal?: AbortSignal): Promise<MyCircle>;
  /** Read-only: the same errors as `joinCircle`, so a preview that works predicts the join. */
  previewInvite(inviteCode: string, signal?: AbortSignal): Promise<InvitePreviewView>;
  createCircle(cmd: CreateCircleCommand): Promise<CircleRef>;
  joinCircle(cmd: JoinCircleCommand): Promise<CircleRef>;
  generateInvite(circleId: string): Promise<CircleInvite>;
  renameCircle(circleId: string, name: string): Promise<void>;
  renameMyDisplayName(circleId: string, displayName: string): Promise<void>;
  leaveCircle(circleId: string): Promise<void>;
  requestPause(seasonId: string, cmd: RequestPauseCommand): Promise<PauseRequestDto>;
  /** My requests, the ones awaiting my answer, my budgets and the 30b comparison (PA-2). */
  getMyPauseRequests(signal?: AbortSignal): Promise<MyPauseRequests>;
  /** "Set my answer": idempotent while pending, `PauseAlreadyDecided` after (D2). */
  respondToPause(pauseRequestId: string, decision: PauseDecision): Promise<PauseApprovalDto>;
  /** Withdraws a pending request (Q2). */
  cancelPauseRequest(pauseRequestId: string): Promise<PauseRequestDto>;
  /** One Commitment, or every one still running when omitted ("Todos", PL-33). */
  resumePause(pauseRequestId: string, commitmentId?: string): Promise<PauseRequestDto>;
  /**
   * The owner's view of one review period (33, 34, 35a, 35c, 13). `periodIndex` is 0 for the
   * baseline and 1-based after. Any slot status reads; the web decides what to show.
   */
  getReview(seasonId: string, periodIndex: number, signal?: AbortSignal): Promise<ReviewDraftDto>;
  /** Saves the review once; a second submission is `ReviewAlreadySubmitted` (409). */
  submitReview(
    seasonId: string,
    periodIndex: number,
    cmd: SubmitReviewCommand,
  ): Promise<SubmittedReviewDto>;
  /** "Ahora no" on the baseline offer: stored, so the offer stops (only period 0 can be skipped). */
  skipBaseline(seasonId: string): Promise<void>;
  /** The derived stage of one of MY commitments; owner-only (a peer's is a 404). */
  getCommitmentStage(
    seasonId: string,
    commitmentId: string,
    signal?: AbortSignal,
  ): Promise<CommitmentStageDto>;
  /**
   * The owner's final figures of an ended season (36). Readable from the results day on, before
   * and after the season is finalized; owner-only, no route carries a member id (ADR-0015).
   */
  getSeasonResults(seasonId: string, signal?: AbortSignal): Promise<SeasonResultsDto>;
  /** The member's single, final closure (37 to 38b); a second one is `ClosureAlreadySubmitted` (409). */
  submitSeasonClosure(seasonId: string, cmd: SubmitClosureCommand): Promise<SubmittedClosureDto>;
  /** The defaults for the next pact, from the member's own closure of the previous season (pactOpen only). */
  getCarryOver(seasonId: string, signal?: AbortSignal): Promise<CarryOverDto>;
  /** The closed seasons of the viewer's circle in which they held a commitment, newest first. */
  getSeasonHistory(signal?: AbortSignal): Promise<SeasonHistoryDto>;
  /**
   * The viewer's pooled consistency across the circle's seasons and their habits with the derived
   * stage (Perfil). Owner-only and total: no circle is zeros, never an error (ADR-0011 Q23).
   */
  getProfileSummary(signal?: AbortSignal): Promise<ProfileSummaryDto>;
  /**
   * The circle activity feed as the viewer may see it (ADR-0018), newest first, 20 items a page.
   * Omit `cursor` for the first page, which also carries the encouragement nudge; pass the previous
   * page's `nextCursor` for the next one. Total: no circle or no started season is an empty feed.
   */
  feed(cursor?: string | null, signal?: AbortSignal): Promise<CircleFeedDto>;
  /** One reaction per member per item; a different emoji changes it. Idempotent. Counts only come back. */
  reactToFeedItem(seasonId: string, itemKey: string, emoji: ReactionCode): Promise<ReactionsDto>;
  /** Takes the viewer's reaction back. Idempotent. */
  removeFeedReaction(seasonId: string, itemKey: string): Promise<ReactionsDto>;
  /** Sends the nudge's encouragement; `EncouragementAlreadySent` (409) when this case already got one. */
  sendEncouragement(seasonId: string, cmd: SendEncouragementCommand): Promise<void>;
  /** "Ahora no": the nudge is not offered again for this case. Idempotent. */
  dismissNudge(seasonId: string, cmd: DismissNudgeCommand): Promise<void>;
  /** The server's public VAPID key; null when Web Push is not configured (ADR-0017). */
  getPushConfig(signal?: AbortSignal): Promise<PushConfigDto>;
  /** Registers this device for the signed-in user (idempotent by endpoint). */
  savePushSubscription(subscription: DevicePushSubscription): Promise<void>;
  /** Removes this device for the signed-in user; removing a missing one succeeds. */
  removePushSubscription(endpoint: string): Promise<void>;
}

export interface PushConfigDto {
  readonly vapidPublicKey: string | null;
}
