import type {
  CarryOverDto,
  SeasonHistoryDto,
  SeasonResultsDto,
  SubmittedClosureDto,
} from "../ports/wire.ts";

/**
 * Runtime checks for the season close reads and writes (ADR-0015). Structure only: the app owns
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

const decision = oneOf("continue", "adjust", "pause", "graduate");

const resultsCommitment = shape({
  commitmentId: id,
  habitId: id,
  habitName: text,
  icon: nullable(text),
  points: count,
  consistencyPercent: nullable(count),
  idealPercent: nullable(count),
  automaticity: shape({ from: nullable(text), to: nullable(text) }),
  stage: oneOf("new", "developing", "integrated", "graduated"),
});

export const isSeasonResults = (data: unknown): data is SeasonResultsDto =>
  shape({
    seasonId: id,
    status: oneOf("active", "closed"),
    lengthWeeks: oneOf(4, 6, 8, 12),
    actualStart: date,
    lastDay: date,
    totals: shape({
      points: count,
      consistencyPercent: nullable(count),
      idealPercent: nullable(count),
    }),
    standings: shape({
      rank: nullable(count),
      memberCount: count,
      gap: nullable(shape({ displayName: text, points: count })),
    }),
    commitments: list(resultsCommitment),
    closingReviewDone: bool,
    closure: nullable(
      shape({
        decidedAt: text,
        decisions: list(shape({ commitmentId: id, decision })),
      }),
    ),
  })(data);

export const isSubmittedClosure = (data: unknown): data is SubmittedClosureDto =>
  shape({
    decidedAt: text,
    decisions: list(shape({ commitmentId: id, decision })),
    graduatedHabitIds: list(id),
    seasonClosed: bool,
  })(data);

export const isCarryOver = (data: unknown): data is CarryOverDto =>
  shape({
    previousSeasonId: nullable(id),
    items: list(
      shape({
        habitId: id,
        decision: oneOf("continue", "adjust", "pause"),
        previous: shape({
          measure: isRec,
          weightPercent: count,
          privacy: oneOf("visible", "private"),
        }),
      }),
    ),
  })(data);

export const isSeasonHistory = (data: unknown): data is SeasonHistoryDto =>
  shape({
    seasons: list(
      shape({
        seasonId: id,
        lengthWeeks: oneOf(4, 6, 8, 12),
        actualStart: date,
        lastDay: date,
        points: count,
        rank: nullable(count),
        memberCount: count,
        closedByMe: bool,
      }),
    ),
  })(data);
