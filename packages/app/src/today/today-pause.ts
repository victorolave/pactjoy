import type { CommitmentId, PauseRequest, Season, SeasonDay } from "@pactjoy/engine";
import { pauseBudget } from "@pactjoy/engine";
import type { EffectivePauseRequest } from "../pause/effective-pauses.ts";
import type { PauseReason } from "../pause/pause-request.ts";
import { plannedBudgetHistory } from "../pause/planned-budget.ts";
import type { PauseRequestId } from "../shared/ids.ts";
import type { LocalDate } from "../time/local-date.ts";

/**
 * The pause a Today row belongs to (PA-9, TR-1..TR-3), or `null`: the request
 * that is pending or approved and still running or yet to start. Derived on
 * every read from the effective decision, stored nowhere.
 */
export interface TodayPause {
  readonly pauseRequestId: PauseRequestId;
  readonly status: "pending" | "approved";
  readonly reason: PauseReason;
  /** The last paused day; `null` for an open pause ("until I resume"). */
  readonly endDate: LocalDate | null;
  /** Reanudar plus "Pedir mas dias" apply (D11, Q12): the last paused day is tomorrow. */
  readonly endsTomorrow: boolean;
  /** An approved pause, running or not yet started (a future one acts as a cancel, Q6). */
  readonly canResume: boolean;
  /** A pending request: only the requester can withdraw it. */
  readonly canCancel: boolean;
}

export interface TodayPauseContext {
  readonly season: Season;
  readonly today: SeasonDay;
  /** The viewer's own requests with their effective decision at the read. */
  readonly requests: readonly EffectivePauseRequest[];
  /** The engine form of the Commitment's own history, for the cap (open pauses end at it). */
  readonly history: readonly PauseRequest[];
  readonly dateOf: (day: number) => LocalDate;
}

/** The pause of one Commitment for a Today row. */
export function todayPauseOf(
  commitmentId: CommitmentId,
  context: TodayPauseContext,
): TodayPause | null {
  const { today, season } = context;
  const { cap, usedDays, remainingDays } = pauseBudget(
    season,
    plannedBudgetHistory(context.history),
    today,
  );

  const candidates = context.requests.flatMap(({ record, decision }) => {
    if (decision.status !== "pending" && decision.status !== "approved") return [];
    const item = record.commitments.find((c) => c.commitmentId === commitmentId);
    if (!item) return [];
    const open = record.end.kind === "open";
    const lastDay = record.end.kind === "fixed" ? record.end.lastDay : null;
    if (decision.status === "approved") {
      if (item.resumedOn !== null) return [];
      if (lastDay !== null && lastDay < today) return [];
      // An open pause stops itself at the cap (E15): once today is past it, nothing runs.
      if (open && record.startDay <= today && usedDays > cap) return [];
    } else if (lastDay !== null && lastDay < today) {
      return [];
    }
    return [{ record, status: decision.status, lastDay, open }];
  });

  // The one covering today first, then the next to start.
  const ordered = [...candidates].sort((a, b) => {
    const aStarted = a.record.startDay <= today ? 0 : 1;
    const bStarted = b.record.startDay <= today ? 0 : 1;
    return aStarted - bStarted || a.record.startDay - b.record.startDay;
  });
  const chosen = ordered[0];
  if (!chosen) return null;

  const started = chosen.record.startDay <= today;
  const endsTomorrow =
    chosen.status === "approved" &&
    started &&
    (chosen.open ? remainingDays === 1 : chosen.lastDay === today + 1);
  return {
    pauseRequestId: chosen.record.id,
    status: chosen.status,
    reason: chosen.record.reason,
    endDate: chosen.lastDay === null ? null : context.dateOf(chosen.lastDay),
    endsTomorrow,
    canResume: chosen.status === "approved",
    canCancel: chosen.status === "pending",
  };
}
