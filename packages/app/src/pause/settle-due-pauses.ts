import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { SeasonId } from "../shared/ids.ts";
import { ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { settleSeasonPauses } from "./settle.ts";

export interface SettleDuePausesDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

/** The job runs as the system: there is no actor. */
export type SettleDuePausesInput = Record<string, never>;

export interface SettleDuePausesResult {
  /** How many requests this run persisted; `0` on a repeat. */
  readonly settled: number;
}

/**
 * Persists every pending request whose `autoApproveAt` has passed, with the
 * decision and `decidedOn` of its own deadline (PL-19), whenever it runs.
 * Idempotent: a settled request is final, so a second run settles 0 and
 * changes nothing. Nothing depends on it for correctness (reads derive the
 * same decision without a job, PL-18); it only keeps the table tidy. Change D
 * will have pg_cron trigger it. One transaction per season, so a conflict in
 * one season does not undo the others.
 */
export async function settleDuePauses(
  deps: SettleDuePausesDeps,
  _input: SettleDuePausesInput,
): Promise<Result<SettleDuePausesResult, never>> {
  const now = deps.clock.now();
  const seasons: readonly SeasonId[] = await deps.uow.read(async (repos) => [
    ...new Set((await repos.pauses.listDue(now)).map((record) => record.seasonId)),
  ]);

  let settled = 0;
  for (const seasonId of seasons) {
    const result = await deps.uow.transaction(async (repos) => {
      const season = await repos.seasons.get(seasonId);
      const circle = season ? await repos.circles.get(season.circleId) : null;
      if (!season || !circle) return ok(0);
      return ok(await settleSeasonPauses(repos, { season, circle, now, timeZone: deps.timeZone }));
    });
    if (result.ok) settled += result.value;
  }
  return ok({ settled });
}
