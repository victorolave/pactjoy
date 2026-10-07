import type { TodayView } from "@pactjoy/app";
import { addDays, daysBetween } from "../../shared/date.ts";
import { longDate } from "../../shared/format.ts";

type Seasoned = Extract<TodayView, { state: "pactOpen" | "notStarted" | "active" | "ended" }>;
type Running = Extract<TodayView, { state: "active" | "ended" }>;
type Row = Running["rows"][number];
export type DayTodayRow = Extract<Row, { kind: "day" }>;
export type WeekTodayRow = Extract<Row, { kind: "week" }>;
type DayRow = DayTodayRow;
type WeekRow = WeekTodayRow;

/** What the Today screen renders, derived once from the server's view. Pure. */
export type TodayModel =
  | { readonly kind: "noCircle" }
  | { readonly kind: "noSeason"; readonly circleName: string }
  | {
      readonly kind: "pactOpen";
      readonly seasonId: string;
      readonly circleName: string;
      readonly lengthWeeks: number;
      readonly startDate: string;
    }
  | {
      readonly kind: "notStarted";
      readonly seasonId: string;
      readonly circleName: string;
      readonly lengthWeeks: number;
      readonly startDate: string;
      readonly today: string;
      readonly daysUntilStart: number;
      readonly myCommitments: readonly {
        readonly id: string;
        readonly habitName: string;
        readonly icon: string | null;
        readonly weightPercent: number;
        readonly maxPoints: number;
      }[];
    }
  | {
      readonly kind: "active" | "ended";
      /** The viewer's per-circle display name, or null when the standings do not list them. */
      readonly seasonId: string;
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
      /** Day-bound opportunities of yesterday still open to register (design 15d). */
      readonly pendingYesterday: Running["pendingYesterday"];
      /** What was registered yesterday and can still be changed: it lives in the De ayer card. */
      readonly yesterdayRegistered: readonly YesterdayRegistered[];
      /** Every row with ALL its entries, so the edit sheet reaches yesterday's too. */
      readonly sheetRows: Running["rows"];
      readonly counts: { readonly logged: number; readonly scheduled: number };
      /** Whole points the viewer's entries for the described day earned, from the server. */
      readonly pointsToday: number;
      /**
       * `allDone`: everything for today is registered and each row has a real done or quantity.
       * `allLogged`: everything is registered but some day was marked "Hoy no salió": not a success.
       */
      readonly dayState: "pending" | "allDone" | "allLogged" | "none";
      readonly today: string;
      /** The day the rows describe: today, or the last season day once ended. */
      readonly refDate: string;
      readonly season: SeasonCardModel;
      readonly standings: StandingsPairModel | null;
    };

/** One entry of yesterday, with the row of its commitment (design 15d). */
export interface YesterdayRegistered {
  readonly row: Row;
  readonly entry: Row["entries"][number];
}

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
  seasonId: view.season.id,
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

const DAYS_PER_WEEK = 7;

/** The rows describe today, or the season's last day once it is over (its grace period). */
function refDateOf(view: Running): string {
  const start = view.season.actualStart;
  if (view.state !== "ended" || start === null) return view.today;
  return addDays(start, view.season.lengthWeeks * DAYS_PER_WEEK - 1);
}

function dayStateOf(
  registrable: readonly DayRow[],
  logged: number,
): "pending" | "allDone" | "allLogged" | "none" {
  if (registrable.length === 0) return "none";
  if (logged !== registrable.length) return "pending";
  // Only a row whose every entry is a "Hoy no salió" fails to count as achieved.
  const achieved = (row: DayRow) =>
    !row.entries.every((entry) => entry.value.kind === "missed") || row.entries.length === 0;
  return registrable.every(achieved) ? "allDone" : "allLogged";
}

/**
 * A DAY row shows and edits ONLY the entries of the day on display; yesterday's have their own place.
 * A week row (timesPerWeek, weeklyTotal) keeps every entry of its week: they have no other home, and
 * its edit entry point must reach a Monday entry on a Friday.
 */
function ofDay<T extends Row>(row: T, refDate: string): T {
  if (row.kind !== "day") return row;
  return { ...row, entries: row.entries.filter((entry) => entry.forDate === refDate) };
}

const NO_POINTS: Row["points"] = {
  perOpportunity: null,
  perOpportunityExact: null,
  earned: null,
  limitPercents: null,
};

/**
 * Version skew: an API older than this client lacks the newer fields. They default to "nothing" here,
 * once, so no screen reads an undefined (the type says they are always there; the wire may not).
 */
function normalised(view: Running): Running {
  return {
    ...view,
    pendingYesterday: view.pendingYesterday ?? [],
    summary: { ...view.summary, pointsToday: view.summary.pointsToday ?? 0 },
    rows: view.rows.map((row) => (row.points === undefined ? { ...row, points: NO_POINTS } : row)),
  };
}

function running(raw: Running): TodayModel {
  const view = normalised(raw);
  const refDate = refDateOf(view);
  const yesterday = addDays(view.today, -1);
  const yesterdayRegistered =
    view.state === "ended"
      ? []
      : view.rows.flatMap((row) =>
          (row.kind === "day" ? row.entries : [])
            .filter((entry) => entry.forDate === yesterday)
            .map((entry): YesterdayRegistered => ({ row, entry })),
        );
  const rows = view.rows.map((row) => ofDay(row, refDate));
  const days = rows.filter((row): row is DayRow => row.kind === "day");
  const forToday = days.filter((row) => row.scheduledToday);
  const registrable = forToday.filter(isRegistrable);
  const logged = registrable.filter((row) => row.opportunity.state === "logged").length;
  return {
    kind: view.state,
    seasonId: view.season.id,
    greetingName:
      view.standings.rows.find((row) => row.memberId === view.viewerId)?.displayName ?? null,
    dateLabel: longDate(view.today),
    weekLabel: `Semana ${view.summary.week} de ${view.summary.weekCount}`,
    sections: {
      forToday,
      otherDays: days.filter((row) => !row.scheduledToday),
      week: rows.filter((row): row is WeekRow => row.kind === "week"),
    },
    pendingYesterday: view.pendingYesterday,
    yesterdayRegistered,
    sheetRows: view.rows,
    counts: { logged, scheduled: registrable.length },
    pointsToday: view.summary.pointsToday,
    today: view.today,
    refDate,
    dayState: dayStateOf(registrable, logged),
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
      return { kind: "pactOpen", ...seasonOf(view) };
    case "notStarted": {
      const base = seasonOf(view);
      return {
        kind: "notStarted",
        ...base,
        today: view.today,
        daysUntilStart: Math.max(0, daysBetween(view.today, base.startDate)),
        myCommitments: view.myCommitments ?? [],
      };
    }
    case "active":
    case "ended":
      return running(view);
  }
}
