import type { MemberId } from "@pactjoy/engine";
import type { MemberScoreView } from "../score/member-score.query.ts";
import { memberScoreView } from "../score/member-score.query.ts";
import { type ScoreQueryDeps, scoreContextOf } from "../score/score-context.ts";
import type { StandingsView } from "../score/standings.query.ts";
import { standingsView } from "../score/standings.query.ts";
import type { SeasonLengthWeeks } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { CircleId, SeasonId } from "../shared/ids.ts";
import type { LocalDate } from "../time/local-date.ts";
import type { TimeZoneId } from "../time/time-zone.port.ts";
import { type PendingYesterdayItem, pendingYesterday } from "./pending-yesterday.ts";
import { seasonPhase, weekOf } from "./season-phase.ts";
import { type TodayRow, todayRows } from "./today-rows.ts";

export type TodayDeps = ScoreQueryDeps;

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
  /**
   * Whole points of the slots today's entries filled (the day's row `earned` values, summed exactly
   * and rounded once). A make-up entry counts for the slot it covered; one with no free slot adds 0.
   * Week-bound opportunities are not in it until the week is counted. (Design 15b "+14 pts hoy".)
   */
  readonly pointsToday: number;
  readonly score: MemberScoreView;
}

/**
 * The Today screen's state machine (TD-R2). `noCircle` and `noSeason` carry
 * no zone, so they carry no `today` either: it exists only with a season.
 */
export type TodayView =
  | { readonly state: "noCircle" }
  | { readonly state: "noSeason"; readonly circle: TodayCircle }
  | ({
      readonly state: "pactOpen" | "notStarted";
      readonly myCommitments: readonly {
        readonly id: string;
        readonly habitName: string;
        readonly icon: string | null;
        readonly weightPercent: number;
        readonly maxPoints: number;
      }[];
    } & TodayBase)
  | ({
      readonly state: "active" | "ended";
      readonly summary: TodaySummary;
      /** One per commitment of the viewer, in season order. */
      readonly rows: readonly TodayRow[];
      /** Day-bound opportunities of yesterday still open to register (design 15d). */
      readonly pendingYesterday: readonly PendingYesterdayItem[];
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
    const phase = seasonPhase(season, base.today);
    if (phase.phase === "pactOpen" || phase.phase === "notStarted") {
      const mine = season.commitments.filter((c) => c.memberId === viewer.id);
      const habits = new Map(
        (await repos.habits.getMany(mine.map((c) => c.habitId))).map((h) => [h.id, h]),
      );
      const myCommitments = mine.map((c) => {
        const habit = habits.get(c.habitId);
        if (!habit) throw new Error(`habit ${c.habitId} of commitment ${c.id} not found`);
        return {
          id: c.id,
          habitName: habit.name,
          icon: habit.icon,
          weightPercent: c.weightPercent,
          maxPoints: c.weightPercent * 10,
        };
      });
      return { state: phase.phase, ...base, myCommitments };
    }
    const actualStart = season.actualStart;
    if (actualStart === null) {
      // Unreachable: seasonPhase returns notStarted without a start day.
      throw new Error(`season ${season.id} is ${phase.phase} without an actual start`);
    }
    const { day, scoringDay, lastDay } = phase;
    const ended = phase.phase === "ended";
    const context = scoreContextOf(deps, season, circle, actor);
    if (!context.ok) {
      // Unreachable: `viewer` above is an active member, which scoreContextOf always accepts.
      throw new Error(`viewer ${viewer.id} cannot read season ${season.id}`);
    }
    const started = {
      ...context.value,
      start: { actualStart, today: scoringDay },
    };
    const data = {
      entries: await repos.entries.listBySeason(season.id),
      pauses: await repos.pauses.listBySeason(season.id),
    };
    const mine = season.commitments.filter((commitment) => commitment.memberId === viewer.id);
    const habits = await repos.habits.getMany(mine.map((commitment) => commitment.habitId));
    const rowsInput = {
      season,
      actualStart,
      commitments: mine,
      habits,
      entries: data.entries.filter((entry) => entry.memberId === viewer.id),
      pauses: data.pauses.filter((pause) => pause.memberId === viewer.id),
      today: day,
      refDay: scoringDay,
    };
    const { rows, pointsToday } = todayRows(rowsInput);
    return {
      state: ended ? "ended" : "active",
      ...base,
      rows,
      pendingYesterday: pendingYesterday(rowsInput),
      summary: {
        week: weekOf(scoringDay),
        weekCount: season.lengthWeeks,
        daysLeft: lastDay - scoringDay,
        pointsToday,
        score: memberScoreView(started, data, viewer),
      },
      standings: standingsView(started, data),
    };
  });
}
