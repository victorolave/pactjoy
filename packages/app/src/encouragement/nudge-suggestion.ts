import type { CommitmentId, MemberId, SeasonDay } from "@pactjoy/engine";
import { activeMembers, type Circle } from "../circle/circle.ts";
import type { EntryRecord } from "../entry/entry.ts";
import {
  isHardWeek,
  latestFinalWeek,
  memberWeeklySeries,
  pooledWeek,
} from "../feed/week-figures.ts";
import type { EffectivePauseRequest } from "../pause/effective-pauses.ts";
import type { Season } from "../season/season.ts";
import type { LocalDate } from "../time/local-date.ts";
import type { Encouragement, NudgeDismissal } from "./encouragement.ts";

export interface NudgeInput {
  readonly season: Season;
  readonly actualStart: LocalDate;
  /** The engine's "today" (0-based season day). */
  readonly today: SeasonDay;
  /** The civil "today" in the season's time zone: what the daily rule compares. */
  readonly todayDate: LocalDate;
  readonly circle: Circle;
  readonly viewerId: MemberId;
  /** Live entries of the season, whoever owns them. */
  readonly entries: readonly EntryRecord[];
  readonly requests: readonly EffectivePauseRequest[];
  /** The VIEWER's own sends in the season. */
  readonly sent: readonly Encouragement[];
  /** The VIEWER's own dismissals in the season. */
  readonly dismissed: readonly NudgeDismissal[];
}

/** A case `(target, week)` the viewer may encourage, and the commitment that suggests the copy. */
export interface NudgeCase {
  readonly targetId: MemberId;
  /** The target's hard week, 1-based. */
  readonly week: number;
  /** The target's commitment with the most unkept opportunities that week (D1); the view may mask it. */
  readonly commitmentId: CommitmentId;
}

/**
 * The one encouragement the viewer may be offered right now, or `null` (ADR-0018, F13), pure:
 *
 * - **The case.** A target's POOLED figures for the season's LATEST final week are final, with
 *   something counted and fewer than half kept (`2 * kept < counted`, exact integers; exactly half is
 *   not hard, a fully paused week counts nothing). So a case lives about a week and never persists.
 * - **Who.** Not the viewer, only members still in the circle, only participants of the season,
 *   and only in a circle with at least two active members. The first by circle member order
 *   wins: ranking by struggle would put a scoreboard under the kindness.
 * - **Not again.** A case the viewer dismissed or answered is gone for good.
 * - **At most one a day.** On a day the viewer already sent or dismissed anything, there is
 *   no suggestion at all (the strict reading of "una por persona al día"). Whether a suggestion
 *   was merely shown is not counted: reads never write.
 * - Only while the season is `active`; a closed season has no one left to encourage.
 *
 * The subject is the target's commitment with the most unkept opportunities that week; a tie
 * goes to the first in season order.
 */
export function pickNudge(input: NudgeInput): NudgeCase | null {
  const { season, circle, viewerId } = input;
  if (season.status !== "active" || activeMembers(circle).length < 2) return null;
  const actedToday =
    input.sent.some((e) => e.sentOn === input.todayDate) ||
    input.dismissed.some((d) => d.dismissedOn === input.todayDate);
  if (actedToday) return null;

  for (const target of activeMembers(circle)) {
    if (target.id === viewerId) continue;
    const series = memberWeeklySeries({
      season,
      actualStart: input.actualStart,
      memberId: target.id,
      entries: input.entries,
      requests: input.requests,
      today: input.today,
    });
    const week = latestFinalWeek(series, input.today);
    if (week === null || !isHardWeek(pooledWeek(series, week), week, input.today)) continue;

    const caseWeek = week + 1;
    const answered = input.sent.some((e) => e.recipientId === target.id && e.caseWeek === caseWeek);
    const hidden = input.dismissed.some((d) => d.targetId === target.id && d.caseWeek === caseWeek);
    if (answered || hidden) continue;

    let subject: { readonly id: CommitmentId; readonly unkept: number } | null = null;
    for (const { commitmentId, weeks } of series) {
      const figures = weeks[week];
      const unkept = figures === undefined ? 0 : figures.counted - figures.kept;
      if (subject === null || unkept > subject.unkept) subject = { id: commitmentId, unkept };
    }
    if (subject === null) continue;
    return { targetId: target.id, week: caseWeek, commitmentId: subject.id };
  }
  return null;
}
