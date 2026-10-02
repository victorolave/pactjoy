import type { MemberId } from "@pactjoy/engine";
import { seasonDay } from "@pactjoy/engine";
import type { MemberScoreView } from "../score/member-score.query.ts";
import { memberScoreView } from "../score/member-score.query.ts";
import { type ScoreQueryDeps, scoreContextOf } from "../score/score-context.ts";
import type { StandingsView } from "../score/standings.query.ts";
import { standingsView } from "../score/standings.query.ts";
import type { SeasonLengthWeeks } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { CircleId, SeasonId } from "../shared/ids.ts";
import type { LocalDate } from "../time/local-date.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import type { TimeZoneId } from "../time/time-zone.port.ts";

export type TodayDeps = ScoreQueryDeps;

const DAYS_PER_WEEK = 7;

export interface TodayCircle {
  readonly id: CircleId;
  readonly name: string;
}

export interface TodaySeason {
  readonly id: SeasonId;
  readonly lengthWeeks: SeasonLengthWeeks;
  readonly nominalStart: LocalDate;
  /** `null` while the pact is still open. */
  readonly actualStart: LocalDate | null;
}

/** What every state with a season carries. `userId` never appears in a view. */
export interface TodayBase {
  readonly viewerId: MemberId;
  /** The server's "today" in the season's own time zone. */
  readonly today: LocalDate;
  readonly timeZone: TimeZoneId;
  readonly circle: TodayCircle;
  readonly season: TodaySeason;
}

/** Season progress for the viewer; only `active` and `ended` have one. */
export interface TodaySummary {
  /** 1-based week of the season; stays on the last week once the season has ended. */
  readonly week: number;
  readonly weekCount: number;
  /** Days after today that still belong to the season; `0` on the last day and after it. */
  readonly daysLeft: number;
  readonly score: MemberScoreView;
}

/**
 * The Today screen's state machine (TD-R2). `noCircle` and `noSeason` carry
 * no zone, so they carry no `today` either: it exists only with a season.
 */
export type TodayView =
  | { readonly state: "noCircle" }
  | { readonly state: "noSeason"; readonly circle: TodayCircle }
  | ({ readonly state: "pactOpen" | "notStarted" } & TodayBase)
  | ({
      readonly state: "active" | "ended";
      readonly summary: TodaySummary;
      readonly standings: Extract<StandingsView, { kind: "ranked" }>;
    } & TodayBase);

/**
 * What the asking user should see today, in ONE read. The viewer is resolved
 * from `actor.userId` inside it; "today" comes from the injected clock in the
 * season's time zone, so the client never sends a date (TD-R3). A `closed`
 * latest season is treated as no season; `ended` is derived from the date
 * because no job closes seasons yet.
 */
export async function today(deps: TodayDeps, actor: Actor): Promise<TodayView> {
  return deps.uow.read(async (repos): Promise<TodayView> => {
    const circle = await repos.circles.findActiveByUser(actor.userId);
    if (!circle) {
      return { state: "noCircle" };
    }
    const circleView: TodayCircle = { id: circle.id, name: circle.name };
    const season = await repos.seasons.findLatestByCircle(circle.id);
    if (!season || season.status === "closed") {
      return { state: "noSeason", circle: circleView };
    }
    const viewer = circle.members.find(
      (member) => member.userId === actor.userId && member.status === "active",
    );
    if (!viewer) {
      throw new Error(`no active member for user ${actor.userId} in circle ${circle.id}`);
    }
    const base: TodayBase = {
      viewerId: viewer.id,
      today: deps.timeZone.localDateAt(deps.clock.now(), season.timeZone),
      timeZone: season.timeZone,
      circle: circleView,
      season: {
        id: season.id,
        lengthWeeks: season.lengthWeeks,
        nominalStart: season.nominalStart,
        actualStart: season.actualStart,
      },
    };
    if (season.status === "pactOpen") {
      return { state: "pactOpen", ...base };
    }
    if (season.actualStart === null) {
      return { state: "notStarted", ...base };
    }
    const day = toSeasonDay(base.today, season.actualStart);
    if (day.kind === "beforeStart") {
      return { state: "notStarted", ...base };
    }

    const totalDays = season.lengthWeeks * DAYS_PER_WEEK;
    const ended = day.day >= totalDays;
    // Scoring reads the last season day once the season is over (design: ended).
    const lastDay = seasonDay(totalDays - 1);
    const scoringDay = ended ? lastDay : day.day;
    const context = scoreContextOf(deps, season, circle, actor);
    if (!context.ok) {
      throw new Error(`viewer ${viewer.id} cannot read season ${season.id}`);
    }
    const started = {
      ...context.value,
      start: { actualStart: season.actualStart, today: scoringDay },
    };
    const data = {
      entries: await repos.entries.listBySeason(season.id),
      pauses: await repos.pauses.listBySeason(season.id),
    };
    return {
      state: ended ? "ended" : "active",
      ...base,
      summary: {
        week: (scoringDay - (scoringDay % DAYS_PER_WEEK)) / DAYS_PER_WEEK + 1,
        weekCount: season.lengthWeeks,
        daysLeft: lastDay - scoringDay,
        score: memberScoreView(started, data, viewer),
      },
      standings: standingsView(started, data),
    };
  });
}
