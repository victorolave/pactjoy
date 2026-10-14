import type {
  CarryOverView,
  ClosureDecision,
  CommitmentProgressView,
  CommitmentRecord,
  Habit,
  Instant,
  MeasureView,
  MemberProgressView,
  PauseApprovalView,
  PauseBudgetView,
  PauseRedistribution,
  PauseRequestView,
  ProfileSummaryView,
  ResumePreview,
  ReviewDraftView,
  ReviewImprovement,
  Season,
  SeasonHistoryView,
  SeasonProgressView,
  SeasonResultsView,
  WeekSummaryView,
} from "@pactjoy/app";

/**
 * What a use-case view looks like after the API's JSON round trip: an `Instant` becomes an ISO
 * string and a branded string (an id, an invite code) becomes a plain string; a string literal
 * (a phase name) stays as it is. Numbers, booleans and `null` are unchanged. The client types a
 * response as `Serialized<View>` instead of copying the shape by hand, so the two cannot drift
 * apart silently (type-only coupling, ADR-0012).
 */
export type Serialized<T> = T extends Instant
  ? string
  : T extends string
    ? keyof T extends keyof string
      ? T
      : string
    : T extends number | boolean | null | undefined
      ? T
      : T extends readonly (infer Item)[]
        ? readonly Serialized<Item>[]
        : T extends object
          ? { readonly [Key in keyof T]: Serialized<T[Key]> }
          : T;

/** Habits are owner-only; the HTTP presenter deliberately omits ownerId. */
export type HabitDto = Omit<Serialized<Habit>, "ownerId">;
export type CommitmentDto =
  | (Pick<
      Serialized<CommitmentRecord>,
      "id" | "memberId" | "habitId" | "weightPercent" | "privacy"
    > & {
      readonly kind: "detail";
      readonly measure: Serialized<MeasureView>;
      /** Viewer GETs enrich this; mutation responses intentionally omit it. */
      readonly habit?: { readonly name: string; readonly icon: string | null };
    })
  | {
      readonly kind: "hidden";
      readonly id: string;
      readonly memberId: string;
      readonly weightPercent: number;
    };
export type SeasonDto = Omit<Serialized<Season>, "commitments"> & {
  readonly commitments: readonly CommitmentDto[];
};

/** The season progress reads as they arrive over the wire (change pwa-season-progress). */
export type SeasonProgress = Serialized<SeasonProgressView>;
export type MemberProgress = Serialized<MemberProgressView>;
export type CommitmentProgress = Serialized<CommitmentProgressView>;
export type WeekSummary = Serialized<WeekSummaryView>;

/**
 * The pause reads as they arrive over the wire (change pause-workflow, ADR-0013). The requester's
 * projection and the approver's differ: a private Commitment reaches an approver as exactly
 * `{kind: "hidden", commitmentId}` (Q15).
 */
export type PauseRequestDto = Serialized<PauseRequestView>;
export type PauseApprovalDto = Serialized<PauseApprovalView>;
export type PauseBudgetDto = Serialized<PauseBudgetView>;
export type PauseRedistributionDto = Serialized<PauseRedistribution>;
export type ResumePreviewDto = Serialized<ResumePreview>;
export type PauseApprovalCommitmentDto = PauseApprovalDto["commitments"][number];

/** `GET /me/pause-requests`: total, so no season gives empty lists. */
export interface MyPauseRequests {
  readonly seasonId: string | null;
  readonly mine: readonly PauseRequestDto[];
  readonly awaitingMe: readonly PauseApprovalDto[];
  readonly budgets: readonly PauseBudgetDto[];
  readonly redistributed: PauseRedistributionDto | null;
  readonly resumePreviews: readonly ResumePreviewDto[];
}

/**
 * The periodic review as it arrives over the wire (change periodic-review, ADR-0014). Every view
 * is the OWNER's: no member id appears in them, and no peer-facing read carries any of it.
 */
export type ReviewDraftDto = Serialized<ReviewDraftView>;
export type ReviewImprovementDto = Serialized<ReviewImprovement>;
/** `POST /seasons/:id/reviews/:k` (201): only what 35b needs; the stored answers are never echoed. */
export interface SubmittedReviewDto {
  readonly status: "completed";
  readonly improvements: readonly ReviewImprovementDto[];
  /** `null` after the closing review. */
  readonly nextReviewDate: string | null;
}
/** `POST /seasons/:id/reviews/0/skip`. */
export interface SkippedBaselineDto {
  readonly status: "skipped";
}
/** The derived maturity of one of MY commitments. */
export type HabitStageDto = "new" | "developing" | "integrated" | "graduated";
export interface CommitmentStageDto {
  readonly commitmentId: string;
  readonly stage: HabitStageDto;
}

/**
 * The season close as it arrives over the wire (change season-close-graduation, ADR-0015). Every
 * view is the OWNER's: no member id appears in them, and no route carries one.
 */
export type SeasonResultsDto = Serialized<SeasonResultsView>;
export type SeasonResultsCommitmentDto = SeasonResultsDto["commitments"][number];
/** Leave it as it is, adjust it, leave it out of the next season ("Pausar", NOT a Pause) or graduate it. */
export type ClosureDecisionDto = ClosureDecision;
export interface ClosureDecisionEntryDto {
  readonly commitmentId: string;
  readonly decision: ClosureDecisionDto;
}
/** `POST /seasons/:id/closure` (201): the stored decisions, the habits graduated now and whether the season closed. */
export interface SubmittedClosureDto {
  readonly decidedAt: string;
  readonly decisions: readonly ClosureDecisionEntryDto[];
  readonly graduatedHabitIds: readonly string[];
  readonly seasonClosed: boolean;
}
type CarryOverWire = Serialized<CarryOverView>;
/**
 * The API presents each previous measure as a `MeasureView` (the same shape as a commitment's),
 * not as the domain `Measure` the use case returns, so the item's measure is typed as the former.
 */
export interface CarryOverItemDto extends Omit<CarryOverWire["items"][number], "previous"> {
  readonly previous: Omit<CarryOverWire["items"][number]["previous"], "measure"> & {
    readonly measure: Serialized<MeasureView>;
  };
}
export interface CarryOverDto extends Omit<CarryOverWire, "items"> {
  readonly items: readonly CarryOverItemDto[];
}
export type SeasonHistoryDto = Serialized<SeasonHistoryView>;
export type SeasonHistoryItemDto = SeasonHistoryDto["seasons"][number];
/** The Perfil consistency and the habit stages (`GET /me/profile`, ADR-0011 Q23). */
export type ProfileSummaryDto = Serialized<ProfileSummaryView>;

/**
 * `POST /seasons/:id/commitments/:id/photos` (201, ADR-0016): the signed request the browser runs
 * with the photo's bytes, the photo to name when the entry is saved, and until when that works.
 */
export interface PhotoUploadDto {
  readonly photoId: string;
  readonly upload: {
    readonly method: "PUT";
    readonly url: string;
    /** Exactly the headers the signature covers; nothing else may be added (no Authorization). */
    readonly headers: Readonly<Record<string, string>>;
    readonly expiresAt: string;
  };
  readonly attachBy: string;
}
