import type { TodayView } from "@pactjoy/app";
import type {
  CommitmentStageDto,
  ReviewDraftDto,
  SkippedBaselineDto,
  SubmittedReviewDto,
} from "../../ports/wire.ts";

type Season = Extract<TodayView, { state: "active" | "ended" }>;
type PendingReviewDto = NonNullable<Season["pendingReview"]>;
type BaselineOfferDto = NonNullable<Season["baselineOffer"]>;

type Commitment = ReviewDraftDto["commitments"][number];
type SummaryRow = NonNullable<ReviewDraftDto["summary"]>["commitments"][number];

export const LEER = "11111111-1111-4111-8111-111111111111";
export const INGLES = "22222222-2222-4222-8222-222222222222";
export const DIBUJAR = "33333333-3333-4333-8333-333333333333";
export const GYM = "44444444-4444-4444-8444-444444444444";

export const commitmentFixture = (id: string, habitName: string, paused = false): Commitment => ({
  commitmentId: id,
  habitName,
  icon: null,
  paused,
});

const row = (overrides: Partial<SummaryRow> & Pick<SummaryRow, "commitmentId" | "habitName">) =>
  ({
    icon: null,
    scheduleKind: "perSession",
    kept: 0,
    counted: 0,
    consistencyPercent: null,
    idealPercent: null,
    points: 0,
    ...overrides,
  }) satisfies SummaryRow;

/**
 * Screen 33 as designed (weeks 3 and 4): Leer 9 of 10, Ingles 2 of 2 weeks, Dibujar 6 of 6,
 * Gym 3 of 6; consistency 83 %, ideal 77 %, +184 points.
 */
export const designSummary = (final = true): NonNullable<ReviewDraftDto["summary"]> => ({
  final,
  totals: { consistencyPercent: 83, idealPercent: 77, points: 184 },
  commitments: [
    row({
      commitmentId: LEER,
      habitName: "Leer",
      kept: 9,
      counted: 10,
      consistencyPercent: 90,
      idealPercent: 80,
      points: 60,
    }),
    row({
      commitmentId: INGLES,
      habitName: "Inglés",
      scheduleKind: "weeklyTotal",
      kept: 2,
      counted: 2,
      consistencyPercent: 100,
      idealPercent: 72,
      points: 50,
    }),
    row({
      commitmentId: DIBUJAR,
      habitName: "Dibujar",
      kept: 6,
      counted: 6,
      consistencyPercent: 100,
      idealPercent: 100,
      points: 44,
    }),
    row({
      commitmentId: GYM,
      habitName: "Gym",
      kept: 3,
      counted: 6,
      consistencyPercent: 50,
      idealPercent: 40,
      points: 30,
    }),
  ],
});

export const fourCommitments = (gymPaused = false): readonly Commitment[] => [
  commitmentFixture(LEER, "Leer"),
  commitmentFixture(INGLES, "Inglés"),
  commitmentFixture(DIBUJAR, "Dibujar"),
  commitmentFixture(GYM, "Gym", gymPaused),
];

/** An interim review (period 2, weeks 3 and 4) that asks item 1 only (35c). */
export const interimItemOneFixture = (overrides: Partial<ReviewDraftDto> = {}): ReviewDraftDto => ({
  status: "due",
  kind: "interim",
  srbai: "item1",
  weeks: { first: 3, last: 4 },
  dueUntil: "2026-10-06",
  summary: designSummary(),
  commitments: fourCommitments(true),
  ...overrides,
});

/** The mid-season interim review: all four SRBAI items, one commitment per screen (35a). */
export const interimFullFixture = (overrides: Partial<ReviewDraftDto> = {}): ReviewDraftDto =>
  interimItemOneFixture({ srbai: "full", commitments: fourCommitments(false), ...overrides });

/** The baseline (screen 13): full SRBAI, no weeks, no summary. */
export const baselineFixture = (overrides: Partial<ReviewDraftDto> = {}): ReviewDraftDto => ({
  status: "due",
  kind: "baseline",
  srbai: "full",
  weeks: null,
  dueUntil: "2026-09-14",
  summary: null,
  commitments: fourCommitments(false),
  ...overrides,
});

export const closingFixture = (overrides: Partial<ReviewDraftDto> = {}): ReviewDraftDto =>
  interimFullFixture({ kind: "closing", dueUntil: null, ...overrides });

export const submittedFixture = (
  overrides: Partial<SubmittedReviewDto> = {},
): SubmittedReviewDto => ({
  status: "completed",
  improvements: [],
  nextReviewDate: "2026-10-06",
  ...overrides,
});

export const skippedFixture = (): SkippedBaselineDto => ({ status: "skipped" });

export const stageFixture = (
  commitmentId: string,
  stage: CommitmentStageDto["stage"] = "new",
): CommitmentStageDto => ({ commitmentId, stage });

/** The `pendingReview` Today carries (period 2 of an 8-week, 2-week-cadence season). */
export const pendingReviewFixture = (overrides: Partial<PendingReviewDto> = {}): PendingReviewDto =>
  ({
    seasonId: "season-1",
    periodIndex: 2,
    kind: "interim",
    fullSrbai: false,
    firstWeek: 3,
    lastWeek: 4,
    dueUntil: "2026-10-06",
    summaryAvailable: true,
    ...overrides,
  }) as PendingReviewDto;

export const baselineOfferFixture = (overrides: Partial<BaselineOfferDto> = {}): BaselineOfferDto =>
  ({
    seasonId: "season-1",
    periodIndex: 0,
    offeredUntil: "2026-10-04",
    ...overrides,
  }) as BaselineOfferDto;
