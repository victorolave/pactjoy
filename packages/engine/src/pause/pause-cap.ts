/**
 * D9: the pure pause-request cap check — total paused natural days per
 * commitment (never opportunities) MUST NOT exceed 50% of the season
 * length. Requests MUST NOT be retroactive. R4b: pending request days
 * count toward the cap exactly like approved ones. `canRequestPause` is
 * independent of the approval/rejection lifecycle in `pause.ts` — it only
 * answers "is this NEW request allowed", given the commitment's own
 * decided-or-pending history.
 *
 * E15 (open pause auto-resumes at cap): rather than growing
 * `effectivePausedDays`'s own two-argument signature with a `cap` (the
 * option sketched, then explicitly deferred, in slice 5a), the cap is
 * applied as an optional, additive policy — `capPausedDays` here, consumed
 * through `pauseAwareWeekSessions`'s own optional `pauseCap` parameter
 * (`pause-aware-week.ts`). This follows the same pattern already
 * established for `GraceDeadlineFor`: a pluggable parameter that defaults
 * to the existing (uncapped) behavior, so no existing caller changes.
 */
import type { Season, SeasonDay } from "../calendar/season-calendar";
import type { PauseEnd, PauseRequest } from "./pause";
import { effectivePausedDays, pendingHoldDays } from "./pause";

const DAYS_PER_WEEK = 7;
const CAP_SHARE_DENOMINATOR = 2; // 50%

/**
 * D9: the season's 50% cap, in natural days, per commitment. Every season
 * length (4, 6, 8 or 12 weeks) is an exact multiple of 2 weeks, so this
 * always divides evenly — there is no rounding rule to pick here.
 */
export function seasonPauseCap(season: Season): number {
  return (season.lengthWeeks * DAYS_PER_WEEK) / CAP_SHARE_DENOMINATOR;
}

/**
 * E15/auto-resume: keeps only the earliest `cap` days of an already
 * computed paused-day set (sorted ascending) — any day beyond the cap is
 * dropped, which is exactly what "auto-resumes at cap" means for scoring:
 * those later days are simply no longer paused, with no `resumedOn` ever
 * written anywhere.
 */
export function capPausedDays(days: ReadonlySet<SeasonDay>, cap: number): ReadonlySet<SeasonDay> {
  const sorted = [...days].sort((a, b) => a - b);
  return new Set(sorted.slice(0, cap));
}

/**
 * R4b: total days already counted against the cap — approved-paused days
 * (honoring early resume, D8/E22) plus still-pending ("on hold") days,
 * unioned so a day covered by more than one request is never double
 * counted. Both are evaluated `today`, the same snapshot `canRequestPause`
 * itself receives.
 */
function totalDaysUsed(history: readonly PauseRequest[], today: SeasonDay): number {
  const approved = effectivePausedDays(history, today);
  const pending = pendingHoldDays(history, today);
  return new Set<SeasonDay>([...approved, ...pending]).size;
}

export type PauseCheck =
  | { readonly allowed: true; readonly remainingDays: number }
  | {
      readonly allowed: false;
      readonly reason: "retroactive" | "capExhausted" | "exceedsRemainingCap";
    };

/**
 * D9: is `request` allowed for this commitment, given its `history` of
 * already decided-or-pending pause requests? Requests starting before
 * `today` are retroactive and always rejected, regardless of the cap.
 */
export function canRequestPause(
  season: Season,
  history: readonly PauseRequest[],
  request: { readonly startDay: SeasonDay; readonly end: PauseEnd },
  today: SeasonDay,
): PauseCheck {
  if (request.startDay < today) return { allowed: false, reason: "retroactive" };

  const cap = seasonPauseCap(season);
  const used = totalDaysUsed(history, today);
  const remaining = cap - used;
  if (remaining <= 0) return { allowed: false, reason: "capExhausted" };

  if (request.end.kind === "fixed") {
    const requestedDays = request.end.lastDay - request.startDay + 1;
    if (requestedDays > remaining) return { allowed: false, reason: "exceedsRemainingCap" };
    return { allowed: true, remainingDays: remaining - requestedDays };
  }

  return { allowed: true, remainingDays: remaining };
}
