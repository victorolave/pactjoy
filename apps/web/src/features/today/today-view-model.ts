import type { TodayView } from "@pactjoy/app";
import { longDate } from "../../shared/format.ts";

type Seasoned = Extract<TodayView, { state: "pactOpen" | "notStarted" | "active" | "ended" }>;
type Running = Extract<TodayView, { state: "active" | "ended" }>;
type Row = Running["rows"][number];
type DayRow = Extract<Row, { kind: "day" }>;
type WeekRow = Extract<Row, { kind: "week" }>;

/** What the Today screen renders, derived once from the server's view. Pure. */
export type TodayModel =
  | { readonly kind: "noCircle" }
  | { readonly kind: "noSeason"; readonly circleName: string }
  | {
      readonly kind: "pactOpen" | "notStarted";
      readonly circleName: string;
      readonly lengthWeeks: number;
      /** ISO local date the season starts (or is meant to start). */
      readonly startDate: string;
    }
  | {
      readonly kind: "active" | "ended";
      /** The viewer's per-circle display name, or null when the standings do not list them. */
      readonly greetingName: string | null;
      readonly dateLabel: string;
      readonly weekLabel: string;
      readonly sections: {
        /** Day rows scheduled today ("Para hoy"). */
        readonly forToday: readonly DayRow[];
        /** Day rows that do not fall today: shown read-only, never counted as pending. */
        readonly otherDays: readonly DayRow[];
        /** timesPerWeek and weeklyTotal rows ("Esta semana"). */
        readonly week: readonly WeekRow[];
      };
      readonly counts: { readonly logged: number; readonly scheduled: number };
      readonly dayState: "pending" | "allDone" | "none";
      readonly season: SeasonCardModel;
      readonly standings: StandingsPairModel | null;
    };

export interface SeasonCardModel {
  readonly points: string;
  readonly consistency: string;
  readonly idealCompletion: string;
  readonly week: number;
  readonly weekCount: number;
  readonly weekLabel: string;
  readonly daysLeftLabel: string;
}

export type StandingsPairModel =
  | { readonly kind: "solo"; readonly points: number }
  | {
      readonly kind: "pair";
      readonly rank: number;
      readonly participantCount: number;
      readonly viewerPoints: number;
      readonly otherName: string;
      readonly otherPoints: number;
      /** Always >= 0: how far apart the two are. */
      readonly difference: number;
    };

const seasonOf = (view: Seasoned) => ({
  circleName: view.circle.name,
  lengthWeeks: view.season.lengthWeeks,
  startDate: view.season.actualStart ?? view.season.nominalStart,
});

/** Only open and logged rows can be registered on: paused, on-hold and closed ones are not pending. */
const isRegistrable = (row: DayRow): boolean =>
  row.opportunity.state === "open" || row.opportunity.state === "logged";

function daysLeftLabel(view: Running): string {
  if (view.state === "ended") return "La temporada terminó";
  const { daysLeft } = view.summary;
  if (daysLeft === 0) return "Último día";
  return daysLeft === 1 ? "Queda 1 día" : `Quedan ${daysLeft} días`;
}

const percentText = (value: number | null): string => (value === null ? "-" : `${value} %`);

function seasonCard(view: Running): SeasonCardModel {
  const { week, weekCount, score } = view.summary;
  const own = score.kind === "scored" && score.scope === "own" ? score : null;
  return {
    points: score.kind === "scored" ? String(score.points) : "0",
    consistency: percentText(own?.consistency ?? null),
    idealCompletion: percentText(own?.idealCompletion ?? null),
    week,
    weekCount,
    weekLabel: `Semana ${week} de ${weekCount}`,
    daysLeftLabel: daysLeftLabel(view),
  };
}

function standingsPair(view: Running): StandingsPairModel | null {
  const { rows, eligibleParticipantCount } = view.standings;
  const index = rows.findIndex((row) => row.memberId === view.viewerId);
  const viewer = rows[index];
  if (viewer === undefined) return null;
  if (rows.length === 1 || eligibleParticipantCount === 1)
    return { kind: "solo", points: viewer.points };
  // The member just ahead is the one to catch; the leader looks at the one right behind.
  const other = rows[index - 1] ?? rows[index + 1];
  if (other === undefined) return { kind: "solo", points: viewer.points };
  return {
    kind: "pair",
    rank: viewer.rank,
    participantCount: eligibleParticipantCount,
    viewerPoints: viewer.points,
    otherName: other.displayName,
    otherPoints: other.points,
    difference: Math.abs(other.points - viewer.points),
  };
}

function running(view: Running): TodayModel {
  const days = view.rows.filter((row): row is DayRow => row.kind === "day");
  const forToday = days.filter((row) => row.scheduledToday);
  const registrable = forToday.filter(isRegistrable);
  const logged = registrable.filter((row) => row.opportunity.state === "logged").length;
  return {
    kind: view.state,
    greetingName:
      view.standings.rows.find((row) => row.memberId === view.viewerId)?.displayName ?? null,
    dateLabel: longDate(view.today),
    weekLabel: `Semana ${view.summary.week} de ${view.summary.weekCount}`,
    sections: {
      forToday,
      otherDays: days.filter((row) => !row.scheduledToday),
      week: view.rows.filter((row): row is WeekRow => row.kind === "week"),
    },
    counts: { logged, scheduled: registrable.length },
    dayState:
      registrable.length === 0 ? "none" : logged === registrable.length ? "allDone" : "pending",
    season: seasonCard(view),
    standings: standingsPair(view),
  };
}

export function toTodayModel(view: TodayView): TodayModel {
  switch (view.state) {
    case "noCircle":
      return { kind: "noCircle" };
    case "noSeason":
      return { kind: "noSeason", circleName: view.circle.name };
    case "pactOpen":
    case "notStarted":
      return { kind: view.state, ...seasonOf(view) };
    case "active":
    case "ended":
      return running(view);
  }
}
