import type { ScoreContextError, ScoreData, ScoreQueryDeps } from "../score/score-context.ts";
import { loadScoreContext } from "../score/score-context.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { ok, type Result } from "../shared/result.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { seasonPhase } from "../today/season-phase.ts";
import type { SeasonProgressView } from "./progress-view.ts";
import { seasonProgressCore } from "./season-progress-core.ts";
import { seasonWeeks } from "./weekly-progress.query.ts";

export type SeasonProgressDeps = ScoreQueryDeps;
export type SeasonProgressError = ScoreContextError;
export interface SeasonProgressInput {
  readonly seasonId: SeasonId;
}

/**
 * Public query for the complete season progress read model (screens 23a–c).
 * One single uow.read captures one instant and composes the core metrics with the live weekly series.
 */
export async function seasonProgress(
  deps: SeasonProgressDeps,
  actor: Actor,
  input: SeasonProgressInput,
): Promise<Result<SeasonProgressView, SeasonProgressError>> {
  return deps.uow.read(async (repos) => {
    const context = await loadScoreContext(deps, repos, actor, input.seasonId);
    if (!context.ok) return context;

    const { season, viewer, start } = context.value;
    if (!start) return ok({ state: "notStarted", seasonId: season.id });

    const today = localDateOfSeasonDay(start.today, start.actualStart);
    const phase = seasonPhase(season, today);
    if (phase.phase === "pactOpen" || phase.phase === "notStarted") {
      return ok({ state: "notStarted", seasonId: season.id });
    }

    const data: ScoreData = {
      entries: await repos.entries.listBySeason(season.id),
      pauses: await repos.pauses.listBySeason(season.id),
    };

    const habits = await repos.habits.getMany(
      season.commitments.filter((c) => c.memberId === viewer.id).map((c) => c.habitId),
    );

    const core = seasonProgressCore(context.value, data, habits);
    if (core.state === "notStarted") return ok(core);

    const weeks = seasonWeeks({
      season,
      actualStart: start.actualStart,
      today: start.today,
      phase,
      standingsRows: core.standings.rows,
      data,
    });

    return ok({
      ...core,
      weeks,
    });
  });
}
