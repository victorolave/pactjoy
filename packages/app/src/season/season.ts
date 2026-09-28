import type { CircleId, SeasonId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import { epochDay, type LocalDate } from "../time/local-date.ts";
import type { TimeZoneId } from "../time/time-zone.port.ts";

/**
 * A season's lifecycle (Temporada). There is no `"draft"` status (B1):
 * every season is created directly with its pact open. Mirrors
 * `circle/season-gate.port.ts`'s `SeasonGateStatus` minus its `"noSeason"`
 * sentinel (which only exists because a circle may never have had one).
 */
export type SeasonStatus = "pactOpen" | "active" | "closed";

export type SeasonLengthWeeks = 4 | 6 | 8 | 12;
export type ReviewCadenceWeeks = 1 | 2 | 3;

/**
 * 4, 6 or 8 weeks worth a season, tracked across a {@link CircleId} (ADR-0008,
 * D6). `commitments`/`approvals`/`pactClosedAt` (design's full interface)
 * are NOT part of this slice's shape yet -- they land with the commitment
 * (S5) and pact (S6) modules, which extend this interface then.
 */
export interface Season {
  readonly id: SeasonId;
  readonly circleId: CircleId;
  readonly timeZone: TimeZoneId;
  readonly nominalStart: LocalDate;
  readonly actualStart: LocalDate | null;
  readonly lengthWeeks: SeasonLengthWeeks;
  readonly reviewCadenceWeeks: ReviewCadenceWeeks;
  readonly status: SeasonStatus;
  readonly createdAt: Instant;
  readonly version: number;
}

const DEFAULT_REVIEW_CADENCE_WEEKS: Record<SeasonLengthWeeks, ReviewCadenceWeeks> = {
  4: 1,
  6: 2,
  8: 2,
  12: 3,
};

/** Default review cadence by season length (Notion Mecánicas, SS-6), overridable at creation. */
export function reviewCadenceForLength(lengthWeeks: SeasonLengthWeeks): ReviewCadenceWeeks {
  return DEFAULT_REVIEW_CADENCE_WEEKS[lengthWeeks];
}

const VALID_LENGTH_WEEKS: readonly SeasonLengthWeeks[] = [4, 6, 8, 12];
const VALID_REVIEW_CADENCE_WEEKS: readonly ReviewCadenceWeeks[] = [1, 2, 3];

/**
 * Runtime membership check for {@link SeasonLengthWeeks} (SHOULD-FIX,
 * review). The `4|6|8|12` union is compile-time only -- TS types are
 * erased at runtime, and the eventual HTTP adapter (change C) will
 * construct `CreateSeasonInput`/`EditSeasonParamsInput` from an arbitrary
 * JSON body, so `createSeason`/`editSeasonParams` must re-check this
 * themselves instead of trusting the type annotation.
 */
export function isSeasonLengthWeeks(value: number): value is SeasonLengthWeeks {
  return (VALID_LENGTH_WEEKS as readonly number[]).includes(value);
}

/** Runtime membership check for {@link ReviewCadenceWeeks} -- same rationale as {@link isSeasonLengthWeeks}. */
export function isReviewCadenceWeeks(value: number): value is ReviewCadenceWeeks {
  return (VALID_REVIEW_CADENCE_WEEKS as readonly number[]).includes(value);
}

/** A6: a season may start any day from today up to this many days ahead, inclusive. */
export const MAX_START_DATE_DAYS_AHEAD = 30;

export type StartDateWindowError =
  | { readonly kind: "StartDateInPast" }
  | { readonly kind: "StartDateTooFarAhead" };

/**
 * A6 (SS-4, SS-5): `startDate` must be between `today` and `today` + 30
 * days, inclusive, both resolved in the season's own timezone. Returns
 * `null` when the date is within the window.
 */
export function validateStartDateWindow(
  startDate: LocalDate,
  today: LocalDate,
): StartDateWindowError | null {
  const diffDays = epochDay(startDate) - epochDay(today);
  if (diffDays < 0) {
    return { kind: "StartDateInPast" };
  }
  if (diffDays > MAX_START_DATE_DAYS_AHEAD) {
    return { kind: "StartDateTooFarAhead" };
  }
  return null;
}

export interface BuildSeasonInput {
  readonly id: SeasonId;
  readonly circleId: CircleId;
  readonly timeZone: TimeZoneId;
  readonly nominalStart: LocalDate;
  readonly lengthWeeks: SeasonLengthWeeks;
  readonly reviewCadenceWeeks: ReviewCadenceWeeks;
  readonly now: Instant;
}

/**
 * Pure constructor for a brand-new {@link Season} (SS-4..SS-6, new SS-17,
 * B1): always `status: "pactOpen"`, never `"draft"`. `create-season.ts` is
 * the only production caller -- it validates the timezone and start-date
 * window first (via `TimeZone`/`validateStartDateWindow`); this function
 * only assembles already-valid inputs (same split as `circle.ts`'s
 * `buildCircle` vs. its use case).
 */
export function buildSeason(input: BuildSeasonInput): Season {
  return {
    id: input.id,
    circleId: input.circleId,
    timeZone: input.timeZone,
    nominalStart: input.nominalStart,
    actualStart: null,
    lengthWeeks: input.lengthWeeks,
    reviewCadenceWeeks: input.reviewCadenceWeeks,
    status: "pactOpen",
    createdAt: input.now,
    version: 0,
  };
}

/**
 * A5/CM-12 (delta, B1): a circle may have at most one pact-open-or-active
 * season at a time. `latest` is the circle's most recently created season
 * of any status (`SeasonRepository.findLatestByCircle`), or `null` if it
 * never had one.
 */
export function canCreateSeasonFor(latest: Season | null): boolean {
  return latest === null || latest.status === "closed";
}
