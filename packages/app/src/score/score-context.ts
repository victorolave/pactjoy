import type { SeasonDay } from "@pactjoy/engine";
import { type Circle, findActiveMember, type Member } from "../circle/circle.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { LocalDate } from "../time/local-date.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import type { TimeZone } from "../time/time-zone.port.ts";

export interface ScoreQueryDeps {
  readonly uow: { read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> };
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

export type ScoreContextError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" };

/**
 * What every score query resolves first: the season, its circle and the
 * asking member (only an ACTIVE member may read scores), plus "today" as a
 * `SeasonDay`. `start` is `null` while the season has not started: its pact
 * is still open, or today (in the season's own timezone) is before its
 * actual start. Real time becomes a `SeasonDay` only through the season
 * clock (ADR-0004, ADR-0009).
 */
export interface ScoreContext {
  readonly season: Season;
  readonly circle: Circle;
  readonly viewer: Member;
  readonly start: { readonly actualStart: LocalDate; readonly today: SeasonDay } | null;
}

export async function loadScoreContext(
  deps: ScoreQueryDeps,
  repos: Repositories,
  actor: Actor,
  seasonId: SeasonId,
): Promise<Result<ScoreContext, ScoreContextError>> {
  const season = await repos.seasons.get(seasonId);
  if (!season) {
    return err({ kind: "SeasonNotFound" });
  }
  const circle = await repos.circles.get(season.circleId);
  const viewer = circle ? findActiveMember(circle, actor.userId) : undefined;
  if (!circle || !viewer) {
    return err({ kind: "NotAMember" });
  }
  if (season.actualStart === null) {
    return ok({ season, circle, viewer, start: null });
  }
  const today = toSeasonDay(
    deps.timeZone.localDateAt(deps.clock.now(), season.timeZone),
    season.actualStart,
  );
  return ok({
    season,
    circle,
    viewer,
    start:
      today.kind === "beforeStart" ? null : { actualStart: season.actualStart, today: today.day },
  });
}
