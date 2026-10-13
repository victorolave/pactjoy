import { findActiveMember } from "../../circle/circle.ts";
import { memberScoreView } from "../../score/member-score.query.ts";
import {
  loadPausesFor,
  type ScoreData,
  type ScoreQueryDeps,
  scoreContextOf,
} from "../../score/score-context.ts";
import { standingsView } from "../../score/standings.query.ts";
import type { Actor } from "../../shared/actor.ts";
import type { SeasonId } from "../../shared/ids.ts";
import type { LocalDate } from "../../time/local-date.ts";
import type { SeasonLengthWeeks } from "../season.ts";
import { lastDayOf, standingOf } from "./season-figures.ts";

export type SeasonHistoryDeps = ScoreQueryDeps;

/** One closed season of the viewer's circle, as Perfil lists it (a link to the read-only results). */
export interface SeasonHistoryItem {
  readonly seasonId: SeasonId;
  readonly lengthWeeks: SeasonLengthWeeks;
  readonly actualStart: LocalDate;
  readonly lastDay: LocalDate;
  readonly points: number;
  /** `null` when everybody finished at zero. */
  readonly rank: number | null;
  readonly memberCount: number;
  /** Whether the viewer submitted their own closure; `false` for a laggard cut off. */
  readonly closedByMe: boolean;
}

export interface SeasonHistoryView {
  /** Newest first. */
  readonly seasons: readonly SeasonHistoryItem[];
}

/**
 * The closed seasons of the viewer's active circle in which they held at least one commitment
 * (decision C11; seasons of circles they left are out of scope). Only their own figures and their
 * own `closedByMe`: no other member's closure, decision or graduation is read. Writes nothing.
 */
export async function seasonHistory(
  deps: SeasonHistoryDeps,
  actor: Actor,
): Promise<SeasonHistoryView> {
  return deps.uow.read(async (repos): Promise<SeasonHistoryView> => {
    const circle = await repos.circles.findActiveByUser(actor.userId);
    const member = circle ? findActiveMember(circle, actor.userId) : undefined;
    if (!circle || !member) return { seasons: [] };

    const seasons: SeasonHistoryItem[] = [];
    for (const season of await repos.seasons.listByCircle(circle.id)) {
      const lastDay = lastDayOf(season);
      const took = season.commitments.some((commitment) => commitment.memberId === member.id);
      if (season.status !== "closed" || season.actualStart === null || lastDay === null || !took) {
        continue;
      }
      const context = scoreContextOf(deps, season, circle, actor);
      if (!context.ok || context.value.start === null) continue;
      const started = { ...context.value, start: context.value.start };
      const data: ScoreData = {
        entries: await repos.entries.listBySeason(season.id),
        pauses: await loadPausesFor(deps, repos, context.value),
      };
      const own = memberScoreView(started, data, started.viewer);
      if (own.kind !== "scored") continue;
      const ranked = standingsView(started, data);
      const standing = standingOf(ranked.rows, member.id, ranked.eligibleParticipantCount);
      seasons.push({
        seasonId: season.id,
        lengthWeeks: season.lengthWeeks,
        actualStart: season.actualStart,
        lastDay,
        points: own.points,
        rank: standing.rank,
        memberCount: standing.memberCount,
        closedByMe: (await repos.seasonClosures.getMine(season.id, member.id)) !== null,
      });
    }
    return { seasons };
  });
}
