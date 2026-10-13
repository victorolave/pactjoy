import type { MemberId } from "@pactjoy/engine";
import type { Repositories } from "../../ports/repositories.ts";
import type { PendingReview } from "../../review/pending-review.ts";
import { reviewDayOf } from "../../review/review-schedule.ts";
import type { LocalDate } from "../../time/local-date.ts";
import type { Season } from "../season.ts";
import { closeDatesOf, seasonCloseCalendar } from "./season-calendar.ts";

/**
 * Which part of the end of the season the viewer is in (Today, decision C10):
 * - `closingReview`: their closing review is pending (the review card owns it, nothing extra);
 * - `resultsSoon`: the review is done and the results day has not come;
 * - `decide`: results open and they have not closed;
 * - `waiting` ("Esperando a tu círculo"): they closed, or have nothing to close.
 */
export type SeasonCloseStep = "closingReview" | "resultsSoon" | "decide" | "waiting";

export interface SeasonCloseView {
  readonly step: SeasonCloseStep;
  /** The civil date the results and the closure open. */
  readonly resultsFrom: LocalDate;
  /** The civil date the circle may open its next season without the members who have not closed. */
  readonly nextSeasonFrom: LocalDate;
  /** A date fact only (no one else's closure is read): the circle may open its next season. */
  readonly nextSeasonOpen: boolean;
}

export interface SeasonCloseArgs {
  readonly season: Season;
  readonly memberId: MemberId;
  /** The season-timezone civil date the read observed. */
  readonly today: LocalDate;
  /** The viewer's pending review, as Today already derived it. */
  readonly pendingReview: PendingReview | null;
}

/**
 * The viewer's end-of-season state for Today, or `null` while the season is still running (or has
 * no start day). Derived on read from the calendar and the viewer's OWN closure; it says nothing
 * about the other members (REQ-T8) and writes nothing (REQ-T9).
 */
export async function seasonCloseOf(
  repos: Pick<Repositories, "seasonClosures">,
  args: SeasonCloseArgs,
): Promise<SeasonCloseView | null> {
  const { season, memberId, today, pendingReview } = args;
  const start = season.actualStart;
  const dates = closeDatesOf(season);
  if (season.status !== "active" || start === null || dates === null) return null;
  const day = reviewDayOf(today, start);
  const calendar = seasonCloseCalendar(season.lengthWeeks);
  if (day.kind !== "day" || day.day <= calendar.lastDay) return null;

  const base = {
    resultsFrom: dates.resultsOn,
    nextSeasonFrom: dates.staleOn,
    nextSeasonOpen: day.day >= calendar.staleFrom,
  };
  if (!season.commitments.some((commitment) => commitment.memberId === memberId)) {
    return { step: "waiting", ...base };
  }
  if (pendingReview?.kind === "closing") return { step: "closingReview", ...base };
  if (day.day < calendar.resultsFrom) return { step: "resultsSoon", ...base };
  const mine = await repos.seasonClosures.getMine(season.id, memberId);
  return { step: mine === null ? "decide" : "waiting", ...base };
}
