import type { Circle, Member } from "../circle/circle.ts";
import { findActiveMember } from "../circle/circle.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { PauseRequestId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Instant } from "../time/instant.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import type { EffectiveDecision } from "./effective-decision.ts";
import { type PauseContext, seasonDayAt } from "./effective-pauses.ts";
import type { PauseRequestRecord } from "./pause-request.ts";
import { settleSeasonPauses } from "./settle.ts";

/** What the three writes on an existing request (respond, cancel, resume) share. */
export interface PauseWriteDeps {
  readonly uow: {
    transaction<T, E>(
      work: (repositories: Repositories) => Promise<Result<T, E>>,
    ): Promise<Result<T, E>>;
  };
  readonly clock: { now(): Instant };
  readonly timeZone: TimeZone;
}

/** A request loaded for a write, together with who is acting and the context its decisions derive from. */
export interface LoadedPauseRequest {
  /** The persisted request AFTER settlement: its `status` is already what a reader sees at `now`. */
  readonly record: PauseRequestRecord;
  readonly season: Season;
  readonly circle: Circle;
  readonly member: Member;
  readonly context: PauseContext;
}

/**
 * The first steps of every write on an existing request (ADR-0013, D4, D9):
 * find it, require that the actor is an ACTIVE member of its circle (anyone
 * else gets `PauseRequestNotFound`, so existence never leaks, PA-S3), guard
 * the circle so a concurrent leave conflicts, and settle the season's due
 * requests (settle-first) before re-reading it.
 */
export async function loadPauseRequestForWrite(
  deps: PauseWriteDeps,
  repos: Repositories,
  actor: Actor,
  id: PauseRequestId,
): Promise<Result<LoadedPauseRequest, { readonly kind: "PauseRequestNotFound" }>> {
  const stored = await repos.pauses.get(id);
  const season = stored ? await repos.seasons.get(stored.seasonId) : null;
  const circle = season ? await repos.circles.get(season.circleId) : null;
  const member = circle ? findActiveMember(circle, actor.userId) : undefined;
  if (!stored || !season || !circle || !member) {
    return err({ kind: "PauseRequestNotFound" });
  }
  await repos.circles.guardVersion(circle.id, circle.version);
  const context: PauseContext = {
    season,
    circle,
    now: deps.clock.now(),
    timeZone: deps.timeZone,
  };
  await settleSeasonPauses(repos, context);
  const record = (await repos.pauses.get(id)) ?? stored;
  return ok({ record, season, circle, member, context });
}

/** The record as a reader sees it: the effective decision laid over the persisted one. */
export function withDecision(
  record: PauseRequestRecord,
  decision: EffectiveDecision,
): PauseRequestRecord {
  if (decision.status === "pending") return record;
  return {
    ...record,
    status: decision.status,
    decidedAt: decision.decidedAt,
    decidedOn: decision.decidedOn,
  };
}

/** The season day of the write's own clock (the only place a write turns `now` into a day). */
export function todayOf(context: PauseContext): ReturnType<typeof seasonDayAt> {
  return seasonDayAt(context, context.now);
}
