import type {
  CommitmentStageDto,
  ReviewDraftDto,
  SkippedBaselineDto,
  SubmittedReviewDto,
} from "../ports/wire.ts";

/**
 * Runtime checks for the periodic review reads and writes (ADR-0014). Structure only: the app owns
 * the rules, these keep a wrong or truncated 2xx from reaching a screen as data (it becomes
 * ApiError("Internal")).
 */

type Check = (value: unknown) => boolean;
type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id: Check = (v) => typeof v === "string" && v.length > 0;
const text: Check = (v) => typeof v === "string";
const bool: Check = (v) => typeof v === "boolean";
const count: Check = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const date: Check = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const oneOf =
  (...options: readonly unknown[]): Check =>
  (v) =>
    options.includes(v);
const list =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check);
const shape =
  (fields: Readonly<Record<string, Check>>): Check =>
  (v) =>
    isRec(v) && Object.entries(fields).every(([key, check]) => check(v[key]));

const summaryRow = shape({
  commitmentId: id,
  habitName: text,
  icon: nullable(text),
  scheduleKind: oneOf("perSession", "weeklyTotal"),
  kept: count,
  counted: count,
  consistencyPercent: nullable(count),
  idealPercent: nullable(count),
  points: count,
});

const summary = shape({
  final: bool,
  totals: shape({
    consistencyPercent: nullable(count),
    idealPercent: nullable(count),
    points: count,
  }),
  commitments: list(summaryRow),
});

export const isReviewDraft = (data: unknown): data is ReviewDraftDto =>
  shape({
    status: oneOf("upcoming", "due", "completed", "skipped", "lapsed"),
    kind: oneOf("baseline", "interim", "closing"),
    srbai: oneOf("full", "item1"),
    weeks: nullable(shape({ first: count, last: count })),
    dueUntil: nullable(date),
    summary: nullable(summary),
    commitments: list(
      shape({ commitmentId: id, habitName: text, icon: nullable(text), paused: bool }),
    ),
  })(data);

export const isSubmittedReview = (data: unknown): data is SubmittedReviewDto =>
  shape({
    status: oneOf("completed"),
    improvements: list(shape({ commitmentId: id, from: text, to: text })),
    nextReviewDate: nullable(date),
  })(data);

export const isSkippedBaseline = (data: unknown): data is SkippedBaselineDto =>
  shape({ status: oneOf("skipped") })(data);

export const isCommitmentStage = (data: unknown): data is CommitmentStageDto =>
  shape({
    commitmentId: id,
    stage: oneOf("new", "developing", "integrated", "graduated"),
  })(data);
