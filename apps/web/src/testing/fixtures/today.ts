import type { TodayView } from "@pactjoy/app";

/**
 * Fixtures mirror what `today()` can produce (packages/app/src/today/today-rows.ts):
 * - a `day` row exists only for perSession + specificDays;
 * - every timesPerWeek or weeklyTotal row is a `week` row with `progress`.
 * today.test.ts pins these invariants.
 */
type Season = Extract<TodayView, { state: "pactOpen" | "notStarted" }>;
type Active = Extract<TodayView, { state: "active" | "ended" }>;
type Row = Active["rows"][number];
export type DayRow = Extract<Row, { kind: "day" }>;
export type WeekRow = Extract<Row, { kind: "week" }>;

// The wire format carries plain strings: these aliases take the branded types from the view so the
// client never needs the engine or the app's brand helpers.
type MemberId = Season["viewerId"];
type LocalDate = Season["today"];

const memberId = (value: string) => value as MemberId;
const localDate = (value: string) => value as LocalDate;

const VIEWER = memberId("member-victor");
/** 2026-10-02 is a Friday: weekday 4 with Monday = 0. */
const TODAY = localDate("2026-10-02");
const ACTUAL_START = localDate("2026-09-28");

type Points = DayRow["points"];

/** The points a row carries: the exact fraction is derived from the 2-decimal value (fixtures only). */
export const pointsFixture = (
  overrides: Pick<Points, "perOpportunity" | "earned" | "limitPercents">,
): Points => ({
  ...overrides,
  perOpportunityExact:
    overrides.perOpportunity === null
      ? null
      : {
          numerator: String(Math.round(Number(overrides.perOpportunity) * 100)),
          denominator: "100",
        },
});

const base = (): Pick<Season, "viewerId" | "today" | "timeZone" | "circle" | "season"> => ({
  viewerId: VIEWER,
  today: TODAY,
  timeZone: "America/Bogota" as Season["timeZone"],
  circle: { id: "circle-1" as Season["circle"]["id"], name: "Los de siempre" },
  season: {
    id: "season-1" as Season["season"]["id"],
    lengthWeeks: 4,
    nominalStart: ACTUAL_START,
    actualStart: ACTUAL_START,
  },
});

export const noCircleTodayFixture = (): TodayView => ({ state: "noCircle" });

export const noSeasonTodayFixture = (): TodayView => ({
  state: "noSeason",
  circle: base().circle,
});

export const pactOpenTodayFixture = (): Season => ({
  state: "pactOpen",
  ...base(),
  season: { ...base().season, actualStart: null },
});

/** A day row: a done habit on Monday, Wednesday and Friday, open and scheduled today (Friday). */
export const dayRowFixture = (overrides: Partial<DayRow> = {}): DayRow => ({
  kind: "day",
  scheduledToday: true,
  commitmentId: "commitment-1" as DayRow["commitmentId"],
  habitName: "Meditar",
  privacy: "visible",
  measure: {
    unit: "done",
    schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [0, 2, 4] } },
  },
  opportunity: { state: "open", graceUntil: localDate("2026-10-03") },
  points: pointsFixture({ perOpportunity: "8", earned: null, limitPercents: null }),
  entries: [],
  ...overrides,
});

export type PendingItem = Active["pendingYesterday"][number];

/** A day-bound opportunity of yesterday (Thursday 2026-10-01) with nothing logged, open until today. */
export const pendingItemFixture = (overrides: Partial<PendingItem> = {}): PendingItem => ({
  commitmentId: "commitment-7" as PendingItem["commitmentId"],
  habitName: "Dibujar",
  privacy: "visible",
  measure: {
    unit: "done",
    schedule: { period: "perSession", frequency: { kind: "specificDays", weekdays: [1, 3, 5] } },
  },
  forDate: localDate("2026-10-01"),
  graceUntil: localDate("2026-10-02"),
  points: pointsFixture({ perOpportunity: "8", earned: null, limitPercents: null }),
  ...overrides,
});

export type Entry = DayRow["entries"][number];

/** One of the viewer's entries for today (2026-10-02). */
export const entryFixture = (value: Entry["value"], overrides: Partial<Entry> = {}): Entry => ({
  entryId: "entry-1" as Entry["entryId"],
  forDate: TODAY,
  value,
  note: null,
  ...overrides,
});

/** A week row: 3 sessions a week of reading, 2 done so far. */
export const weekRowFixture = (overrides: Partial<WeekRow> = {}): WeekRow => ({
  kind: "week",
  commitmentId: "commitment-2" as WeekRow["commitmentId"],
  habitName: "Leer",
  privacy: "visible",
  measure: {
    unit: "minutes",
    customLabel: null,
    precision: "integer",
    target: { direction: "reach", minimum: "10", ideal: "30" },
    schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
  },
  opportunity: { state: "open", graceUntil: localDate("2026-10-05") },
  points: pointsFixture({ perOpportunity: "83.33", earned: null, limitPercents: null }),
  entries: [],
  progress: {
    value: "40",
    target: { direction: "reach", minimum: "10", ideal: "30" },
    sessionsDone: 2,
    sessionsTarget: 3,
    percent: 67,
  },
  ...overrides,
});

const STANDINGS: Active["standings"] = {
  kind: "ranked",
  eligibleParticipantCount: 2,
  rows: [
    { memberId: memberId("member-andrea"), displayName: "Andrea", rank: 1, points: 620 },
    { memberId: VIEWER, displayName: "Victor", rank: 2, points: 540 },
  ],
};

const ownScore = (): Active["summary"]["score"] => ({
  kind: "scored",
  scope: "own",
  memberId: VIEWER,
  displayName: "Victor",
  points: 540,
  consistency: 75,
  idealCompletion: 54,
  commitments: [],
});

/** Day 5 of 28 (Monday start, today Friday): week 1 of 4, 23 days left. */
export const activeTodayFixture = (overrides: Partial<Active> = {}): Active => ({
  state: "active",
  ...base(),
  summary: { week: 1, weekCount: 4, daysLeft: 23, pointsToday: 0, score: ownScore() },
  rows: [dayRowFixture(), weekRowFixture()],
  pendingYesterday: [],
  standings: STANDINGS,
  ...overrides,
});

/** The day after the last season day: the rows describe the last day, daysLeft is 0. */
export const endedTodayFixture = (overrides: Partial<Active> = {}): Active => ({
  state: "ended",
  ...base(),
  today: localDate("2026-10-27"),
  summary: { week: 4, weekCount: 4, daysLeft: 0, pointsToday: 0, score: ownScore() },
  rows: [weekRowFixture({ opportunity: { state: "closed", graceUntil: localDate("2026-10-26") } })],
  pendingYesterday: [],
  standings: STANDINGS,
  ...overrides,
});
