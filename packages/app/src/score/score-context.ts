import type { MemberId, SeasonDay } from "@pactjoy/engine";
import type { Circle, Member } from "../circle/circle.ts";
import type { EntryRecord } from "../entry/entry.ts";
import { loadEffectivePauses } from "../pause/effective-pauses.ts";
import type { MemberPauseRequest } from "../pause/pause-request.repository.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { Instant } from "../time/instant.ts";
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
  /** The ONE instant this read observed: "today" and every pause decision derive from it. */
  readonly now: Instant;
}

/** A season participant is anyone who held at least one commitment in it, whether or not they still belong to the circle. */
export function isParticipant(season: Season, memberId: MemberId): boolean {
  return season.commitments.some((commitment) => commitment.memberId === memberId);
}

/** A `ScoreContext` whose season has started: `start` is guaranteed. */
export type StartedScoreContext = ScoreContext & {
  readonly start: NonNullable<ScoreContext["start"]>;
};

/** What the engine needs besides the season: loaded once, then shared by every core. */
export interface ScoreData {
  readonly entries: readonly EntryRecord[];
  readonly pauses: readonly MemberPauseRequest[];
}

/**
 * The member an actor is in a season's circle, for READ access: any active
 * member, plus participants of the season even after they left the circle or
 * the circle was archived (2026-09-30 decision). `undefined` for everyone else.
 */
export function findViewer(season: Season, circle: Circle, actor: Actor): Member | undefined {
  return circle.members.find(
    (member) =>
      member.userId === actor.userId &&
      (member.status === "active" || isParticipant(season, member.id)),
  );
}

/**
 * The synchronous core of `loadScoreContext`: resolves the viewer and "today"
 * from an already-loaded season and circle, so a caller that composes several
 * reads inside ONE `uow.read` can reuse it without a nested read.
 */
export function scoreContextOf(
  deps: Pick<ScoreQueryDeps, "clock" | "timeZone">,
  season: Season,
  circle: Circle | null,
  actor: Actor,
): Result<ScoreContext, { readonly kind: "NotAMember" }> {
  const viewer = circle ? findViewer(season, circle, actor) : undefined;
  if (!circle || !viewer) {
    return err({ kind: "NotAMember" });
  }
  const now = deps.clock.now();
  if (season.actualStart === null) {
    return ok({ season, circle, viewer, start: null, now });
  }
  const today = toSeasonDay(deps.timeZone.localDateAt(now, season.timeZone), season.actualStart);
  return ok({
    season,
    circle,
    viewer,
    now,
    start:
      today.kind === "beforeStart" ? null : { actualStart: season.actualStart, today: today.day },
  });
}

/**
 * The pauses a score read must use: the effective ones at the query's clock
 * (the choke point, ADR-0013), never the persisted rows.
 */
export function loadPausesFor(
  deps: Pick<ScoreQueryDeps, "timeZone">,
  repos: Repositories,
  context: Pick<ScoreContext, "season" | "circle" | "now">,
): Promise<readonly MemberPauseRequest[]> {
  return loadEffectivePauses(repos, {
    season: context.season,
    circle: context.circle,
    now: context.now,
    timeZone: deps.timeZone,
  });
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
  return scoreContextOf(deps, season, circle, actor);
}
