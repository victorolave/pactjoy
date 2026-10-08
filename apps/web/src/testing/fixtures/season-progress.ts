import type {
  CommitmentProgress,
  MemberProgress,
  SeasonProgress,
  WeekSummary,
} from "../../ports/wire.ts";

/**
 * Minimal complete progress views in the wire shape. The numbers are coherent examples, not
 * engine output: screens render them as given and never recompute them. Season "season-1" runs
 * 2026-08-25..2026-10-19 (8 weeks); today is 2026-09-24, day 3 of week index 4; Victor views.
 */
type Started<T> = Extract<T, { state: "active" | "ended" }>;
type ActiveSeason = Started<SeasonProgress>;
type Row = ActiveSeason["own"]["commitments"][number];

const SEASON: ActiveSeason["season"] = {
  id: "season-1",
  timeZone: "Europe/Madrid",
  lengthWeeks: 8,
  actualStart: "2026-08-25",
  lastDay: "2026-10-19",
};
const CALENDAR = { today: "2026-09-24", weekIndex: 4, dayOfWeek: 3, daysLeft: 25 };
const VIEWER = "member-victor";
const STARTED = { state: "active", viewerId: VIEWER, season: SEASON, calendar: CALENDAR } as const;
/** Viewer first, then up to five peers; the points give ranks with no tie. */
const MEMBERS = ["Victor", "Andrea", "Bruno", "Carla", "Diego", "Elena"].map((name, i) => ({
  memberId: `member-${name.toLowerCase()}`,
  displayName: name,
  points: i === 1 ? 412 : 400 - i * 50,
}));

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const week = (weekIndex: number, current = CALENDAR.weekIndex) =>
  ({
    weekIndex,
    start: addDays(SEASON.actualStart, weekIndex * 7),
    end: addDays(SEASON.actualStart, weekIndex * 7 + 6),
    timing: weekIndex < current ? "past" : weekIndex === current ? "current" : "future",
    facts: {
      counted: weekIndex < current,
      editable: weekIndex === current || weekIndex === current - 1,
      final: weekIndex < current - 1,
    },
  }) as const;

/** Victor's Leer: 25 %, 5 times a week, 10 to 30 minutes. */
export const leerRow = (overrides: Partial<Row> = {}): Row => ({
  kind: "detail",
  commitmentId: "commitment-leer",
  habit: { name: "Leer", icon: "book" },
  weightPercent: 25,
  privacy: "visible",
  measure: {
    unit: "minutes",
    customLabel: null,
    precision: "decimal",
    target: { direction: "reach", minimum: "10", ideal: "30" },
    schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 5 } },
  },
  points: 105,
  consistency: 86,
  idealCompletion: 76,
  opportunities: { kept: 19, counted: 22 },
  streak: { unit: "week", current: 0, best: 1 },
  pause: "none",
  ...overrides,
});

const gymRow = leerRow({
  commitmentId: "commitment-gym",
  habit: { name: "Gym", icon: "dumbbell" },
  weightPercent: 75,
  measure: {
    unit: "done",
    schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
  },
  points: 295,
  pause: "paused",
});

/** Populated 23a for a circle of 1–6 (a pair by default). */
export function activeSeasonProgress({ memberCount = 2 } = {}): ActiveSeason {
  const members = MEMBERS.slice(0, memberCount);
  const ranked = [...members].sort((a, b) => b.points - a.points);
  return {
    ...STARTED,
    circle: { id: "circle-1", name: "Los Pactos" },
    own: { points: 400, consistency: 84, idealCompletion: 78, commitments: [leerRow(), gymRow] },
    standings: {
      memberCount,
      rows: ranked.map((m, i) => ({ ...m, isViewer: m.memberId === VIEWER, rank: i + 1 })),
    },
    weeks: Array.from({ length: SEASON.lengthWeeks }, (_, i) => {
      const future = i > CALENDAR.weekIndex;
      return {
        ...week(i),
        members: members.map(({ memberId }, n) => ({
          memberId,
          points: future ? null : i === CALENDAR.weekIndex ? 20 + n : 90 - n,
          consistency: future ? null : 80,
          idealCompletion: future ? null : 75,
        })),
      };
    }),
  };
}

/** 23b: the season starts today; every row shows 0 (alphabetical, unnumbered), metrics are null. */
export function firstDaySeasonProgress(): ActiveSeason {
  const base = activeSeasonProgress();
  return {
    ...base,
    calendar: { today: SEASON.actualStart, weekIndex: 0, dayOfWeek: 1, daysLeft: 55 },
    own: { points: 0, consistency: null, idealCompletion: null, commitments: [] },
    standings: {
      memberCount: 2,
      rows: base.standings.rows.map((row) => ({ ...row, points: 0, rank: null })),
    },
    weeks: base.weeks.map((w) => ({
      ...week(w.weekIndex, 0),
      members: w.members.map(({ memberId }) => ({
        memberId,
        points: w.weekIndex === 0 ? 0 : null,
        consistency: null,
        idealCompletion: null,
      })),
    })),
  };
}

/** Ended, inside the last day's grace: the calendar stays on the last week, scoring uses today. */
export function endedSeasonProgress(): ActiveSeason {
  return {
    ...activeSeasonProgress(),
    state: "ended",
    calendar: { today: addDays(SEASON.lastDay, 1), weekIndex: 7, dayOfWeek: 7, daysLeft: 0 },
  };
}

/** 23d: Andrea seen by Victor; her private commitment carries only the four allowed fields. */
export function peerMemberProgress(): Started<MemberProgress> {
  return {
    ...STARTED,
    member: { memberId: "member-andrea", displayName: "Andrea" },
    points: 412,
    consistency: 88,
    idealCompletion: 81,
    scope: "others",
    commitments: [
      leerRow({ commitmentId: "commitment-correr", habit: { name: "Correr", icon: "footprints" } }),
      { kind: "hidden", commitmentId: "commitment-secret", weightPercent: 30, points: 118 },
    ],
  };
}

/** 24a: Victor's Leer, the current week with one late ideal session and one future slot. */
export function commitmentProgress(): Started<CommitmentProgress> {
  const current = week(CALENDAR.weekIndex);
  return {
    ...STARTED,
    memberId: VIEWER,
    commitment: leerRow(),
    weeks: [
      {
        ...current,
        status: "scored",
        sessionsDone: 1,
        sessionsTarget: 5,
        cells: [
          {
            kind: "session",
            date: current.start,
            status: "ideal",
            progressPercent: 100,
            late: true,
            evidence: [
              {
                forDate: current.start,
                recordedOn: addDays(current.start, 1),
                value: { kind: "quantity", value: "30" },
                note: "Capítulo 3",
              },
            ],
          },
          {
            kind: "session",
            date: null,
            status: "future",
            progressPercent: null,
            late: false,
            evidence: [],
          },
        ],
      },
    ],
    scoring: {
      perOpportunityPoints: "6.25",
      opportunityCount: 40,
      curve: [
        { value: "5", progressPercent: "0" },
        { value: "10", progressPercent: "33" },
        { value: "30", progressPercent: "100" },
      ],
    },
  };
}

/** 25b: Victor's week index 3 (15–21 sep), his best so far, in a pair. */
export function weekSummary(overrides: Partial<WeekSummary> = {}): WeekSummary {
  return {
    ...week(3),
    viewerId: VIEWER,
    season: SEASON,
    points: 96,
    consistency: 83,
    idealCompletion: 76,
    headline: "best",
    weeksLeft: 4,
    commitments: [
      {
        commitmentId: "commitment-leer",
        habit: { name: "Leer", icon: "book" },
        measure: leerRow().measure,
        points: 20,
        progress: {
          value: "110",
          target: { direction: "reach", minimum: "10", ideal: "30" },
          sessionsDone: 4,
          sessionsTarget: 5,
          percent: 73,
        },
      },
    ],
    circle: [
      { memberId: "member-andrea", displayName: "Andrea", points: 87 },
      { memberId: VIEWER, displayName: "Victor", points: 96 },
    ],
    ...overrides,
  };
}
