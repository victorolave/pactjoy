import type { SeasonDay } from "@pactjoy/engine";
import type { Circle, Member } from "../circle/circle.ts";
import { loadEffectiveRequests } from "../pause/effective-pauses.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { ScoreQueryDeps } from "../score/score-context.ts";
import {
  type SeasonGraduationSource,
  seasonGraduations,
} from "../season/closure/season-graduations.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { Instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import type { FeedWorld } from "./derive-feed.ts";

export type FeedDeps = Pick<ScoreQueryDeps, "clock" | "timeZone">;

/** The season the feed is about and where "now" stands in it (ADR-0018, F2). */
export interface FeedContext {
  readonly circle: Circle;
  /** The newest STARTED season of the circle, active or closed. */
  readonly season: Season;
  readonly actualStart: LocalDate;
  /** The engine's "today" in the season's time zone. */
  readonly today: SeasonDay;
  /** The civil "today" in the season's time zone. */
  readonly todayDate: LocalDate;
  /** The ONE instant this read observed. */
  readonly now: Instant;
}

/**
 * The feed season of a circle (F2): the newest season that has started, whatever its status. A
 * season whose pact is still open, or whose start day is in the future, has not started. During
 * the next season's open pact the feed therefore keeps showing the closing one. `null` when the
 * circle has no started season yet.
 */
export async function feedContextOf(
  deps: FeedDeps,
  repos: Pick<Repositories, "seasons">,
  circle: Circle,
  now: Instant,
): Promise<FeedContext | null> {
  const seasons = await repos.seasons.listByCircle(circle.id);
  for (const season of seasons) {
    if (season.actualStart === null) continue;
    const todayDate = deps.timeZone.localDateAt(now, season.timeZone);
    const today = toSeasonDay(todayDate, season.actualStart);
    if (today.kind === "beforeStart") continue;
    return { circle, season, actualStart: season.actualStart, today: today.day, todayDate, now };
  }
  return null;
}

/** The active member of the circle the actor is, or `undefined`: only active members read or react. */
export function activeViewerOf(circle: Circle, actor: Actor): Member | undefined {
  return circle.members.find((m) => m.userId === actor.userId && m.status === "active");
}

/**
 * The read-set guard of a social WRITE (a reaction, an encouragement, a dismissal), like the one
 * `recordEntry` takes (D5): the membership and the season state it decided from must still be the
 * stored ones at commit, so a concurrent leave or season close makes the write fail with
 * `ConcurrencyConflict` instead of storing something about people or a season that no longer
 * qualify. Circle first, then season (the lock order of `recordEntry`). Call it right after
 * resolving the actor and BEFORE loading the feed world or the social history the eligibility
 * rules read: in Postgres the guard is a `FOR NO KEY UPDATE` lock held to commit, so two writers
 * of the same circle are serialized and the second one's later reads see the first one's rows.
 */
export async function guardSocialWrite(
  repos: Pick<Repositories, "circles" | "seasons">,
  circle: Circle,
  season: Season,
): Promise<void> {
  await repos.circles.guardVersion(circle.id, circle.version);
  await repos.seasons.guardVersion(season.id, season.version);
}

/**
 * Loads what `deriveFeed` reads for a feed season: the live entries, the pauses through their
 * choke point (the effective decision at the read's instant, ADR-0013) and the habits of the
 * season's commitments, plus the season's graduate decisions through the closure module's one
 * public helper. Reads only; nothing else private (reviews, closure decisions, photos) is touched.
 */
export async function loadFeedWorld(
  deps: FeedDeps,
  repos: Pick<Repositories, "entries" | "pauses" | "habits"> & SeasonGraduationSource,
  context: FeedContext,
): Promise<FeedWorld> {
  const { season, circle, now } = context;
  const [entries, requests, habits, graduations] = await Promise.all([
    repos.entries.listBySeason(season.id),
    loadEffectiveRequests(repos, { season, circle, now, timeZone: deps.timeZone }),
    repos.habits.getMany(season.commitments.map((commitment) => commitment.habitId)),
    seasonGraduations(repos, season.id),
  ]);
  return {
    season,
    actualStart: context.actualStart,
    today: context.today,
    entries,
    requests,
    habits,
    graduations,
    timeZone: deps.timeZone,
  };
}
