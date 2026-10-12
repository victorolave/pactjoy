import type { PauseRequest, Season, SeasonDay } from "@pactjoy/engine";
import { seasonPauseCap } from "@pactjoy/engine";

/** The days a new request would cover: `lastDay` is `null` for an open one. */
export interface PauseSpan {
  readonly startDay: SeasonDay;
  readonly lastDay: SeasonDay | null;
}

/**
 * The last day an existing request still claims, or `null` when it claims
 * nothing (an effectively rejected one). Pending and approved requests
 * claim `startDay..end`; an early resume cuts the claim at `resumedOn - 1`;
 * an open one claims until it is resumed or until the cap would end it
 * (Q5), so it is bounded by `startDay + cap - 1`.
 */
function claimedUntil(pause: PauseRequest, season: Season): number | null {
  if (pause.decision.kind === "rejected") return null;
  let end: number =
    pause.end.kind === "fixed" ? pause.end.lastDay : pause.startDay + seasonPauseCap(season) - 1;
  if (pause.decision.kind === "approved" && pause.decision.resumedOn !== null) {
    const lastKept = pause.decision.resumedOn - 1;
    if (lastKept < end) end = lastKept;
  }
  return end >= pause.startDay ? end : null;
}

/**
 * Q5 (PL-28): whether `span` intersects any day a pending or approved
 * request of the SAME Commitment still claims. Rejected and cancelled
 * requests (both `rejected` for the engine) never overlap, and a resumed one
 * only claims the days before its resume day.
 */
export function overlapsExisting(
  span: PauseSpan,
  history: readonly PauseRequest[],
  season: Season,
): boolean {
  const spanEnd = span.lastDay ?? Number.POSITIVE_INFINITY;
  return history.some((pause) => {
    const until = claimedUntil(pause, season);
    return until !== null && span.startDay <= until && pause.startDay <= spanEnd;
  });
}
