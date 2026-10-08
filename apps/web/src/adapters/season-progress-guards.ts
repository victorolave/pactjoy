import type {
  CommitmentProgress,
  MemberProgress,
  SeasonProgress,
  WeekSummary,
} from "../ports/wire.ts";

/**
 * Runtime checks for the season progress reads (L4). Every field a screen consumes is checked,
 * nested unions included; a 2xx that fails becomes ApiError("Internal"), never data. A peer's
 * private row and an entry's evidence must carry EXACTLY their allowed fields, so a server bug
 * cannot leak a hidden habit, metric or entry id through the client.
 */

type Check = (value: unknown) => boolean;
type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id: Check = (v) => typeof v === "string" && v.length > 0;
const text: Check = (v) => typeof v === "string";
const bool: Check = (v) => typeof v === "boolean";
const num: Check = (v) => typeof v === "number" && Number.isFinite(v);
const count: Check = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const date: Check = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** An IANA zone this runtime can format, so the season clock never throws at render. */
const zone: Check = (v) => {
  if (typeof v !== "string" || v.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: v });
    return true;
  } catch {
    return false;
  }
};
const decimal: Check = (v) => typeof v === "string" && /^\d{1,12}(\.\d{1,12})?$/.test(v);
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const oneOf =
  (...options: readonly unknown[]): Check =>
  (v) =>
    options.includes(v);
const list =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check);

/** Every listed field passes; with `exact`, no other field is present. */
const shape =
  (fields: Readonly<Record<string, Check>>, exact = false): Check =>
  (v) =>
    isRec(v) &&
    Object.entries(fields).every(([key, check]) => check(v[key])) &&
    (!exact || Object.keys(v).every((key) => key in fields));

const nullableNum = nullable(num);
const metrics = { points: num, consistency: nullableNum, idealCompletion: nullableNum };

const schedule: Check = (v) =>
  isRec(v) &&
  (v.period === "weeklyTotal" ||
    (v.period === "perSession" &&
      (shape({ kind: oneOf("timesPerWeek"), times: count })(v.frequency) ||
        shape({ kind: oneOf("specificDays"), weekdays: list(count) })(v.frequency))));
const target: Check = (v) =>
  shape({ direction: oneOf("reach"), minimum: decimal, ideal: decimal })(v) ||
  shape({ direction: oneOf("limit"), ideal: decimal, tolerance: decimal })(v);
const measure: Check = (v) =>
  isRec(v) &&
  (v.unit === "done"
    ? isRec(v.schedule) && v.schedule.period === "perSession" && schedule(v.schedule)
    : id(v.unit) &&
      nullable(text)(v.customLabel) &&
      oneOf("integer", "decimal")(v.precision) &&
      target(v.target) &&
      schedule(v.schedule));
const habit = shape({ name: text, icon: nullable(text) });

const detailRow = shape({
  kind: oneOf("detail"),
  commitmentId: id,
  habit,
  weightPercent: num,
  privacy: oneOf("visible", "private"),
  measure,
  ...metrics,
  opportunities: shape({ kept: count, counted: count }),
  streak: shape({ unit: oneOf("day", "week"), current: count, best: count }),
  pause: oneOf("none", "paused", "onHold"),
});
const hiddenRow = shape(
  { kind: oneOf("hidden"), commitmentId: id, weightPercent: num, points: num },
  true,
);

const season = shape({
  id,
  timeZone: zone,
  lengthWeeks: oneOf(4, 6, 8, 12),
  actualStart: date,
  lastDay: date,
});
const calendar = shape({ today: date, weekIndex: count, dayOfWeek: count, daysLeft: count });
const started = { state: oneOf("active", "ended"), viewerId: id, season, calendar };
const notStarted = shape({ state: oneOf("notStarted"), seasonId: id });
const weekRange = {
  weekIndex: count,
  start: date,
  end: date,
  timing: oneOf("past", "current", "future"),
  facts: shape({ counted: bool, editable: bool, final: bool }),
};

const isStartedSeason = shape({
  ...started,
  circle: shape({ id, name: text }),
  own: shape({ ...metrics, commitments: list(detailRow) }),
  standings: shape({
    memberCount: count,
    hasEntries: bool,
    rows: list(
      shape({
        memberId: id,
        displayName: text,
        isViewer: bool,
        rank: nullable(count),
        points: num,
      }),
    ),
  }),
  weeks: list(
    shape({
      ...weekRange,
      members: list(
        shape({
          memberId: id,
          points: nullableNum,
          consistency: nullableNum,
          idealCompletion: nullableNum,
        }),
      ),
    }),
  ),
});

const memberBase = { ...started, ...metrics, member: shape({ memberId: id, displayName: text }) };
const isStartedMember: Check = (v) =>
  shape({ ...memberBase, scope: oneOf("own"), commitments: list(detailRow) })(v) ||
  shape({
    ...memberBase,
    scope: oneOf("others"),
    // A peer's private commitment only ever arrives as a hidden row, never with its detail.
    commitments: list(
      (row) => (detailRow(row) && isRec(row) && row.privacy === "visible") || hiddenRow(row),
    ),
  })(v);

const evidence = shape(
  {
    forDate: date,
    recordedOn: date,
    value: (v) =>
      shape({ kind: oneOf("done", "missed") }, true)(v) ||
      shape({ kind: oneOf("quantity"), value: decimal }, true)(v),
    note: nullable(text),
  },
  true,
);
const cell = shape({
  kind: oneOf("day", "session", "week"),
  date: nullable(date),
  status: oneOf(
    "ideal",
    "minimum",
    "below",
    "missed",
    "unrecorded",
    "pending",
    "future",
    "paused",
    "onHold",
  ),
  progressPercent: nullableNum,
  late: bool,
  evidence: list(evidence),
});
const isStartedCommitment = shape({
  ...started,
  memberId: id,
  commitment: detailRow,
  weeks: list(
    shape({
      ...weekRange,
      status: oneOf("scored", "paused", "onHold"),
      sessionsDone: count,
      sessionsTarget: count,
      cells: list(cell),
    }),
  ),
  scoring: shape({
    perOpportunityPoints: nullable(decimal),
    opportunityCount: count,
    curve: nullable(list(shape({ value: decimal, progressPercent: decimal }))),
  }),
});

const weekProgress = shape({
  value: nullable(decimal),
  target,
  sessionsDone: count,
  sessionsTarget: count,
  percent: num,
});

export const isSeasonProgress = (v: unknown): v is SeasonProgress =>
  notStarted(v) || isStartedSeason(v);

export const isMemberProgress = (v: unknown): v is MemberProgress =>
  notStarted(v) || isStartedMember(v);

export const isCommitmentProgress = (v: unknown): v is CommitmentProgress =>
  notStarted(v) || isStartedCommitment(v);

export const isWeekSummary = (v: unknown): v is WeekSummary =>
  shape({
    ...weekRange,
    ...metrics,
    viewerId: id,
    season,
    headline: nullable(oneOf("best", "difficult")),
    weeksLeft: count,
    commitments: list(
      shape({
        commitmentId: id,
        habit,
        measure,
        points: nullableNum,
        progress: nullable(weekProgress),
      }),
    ),
    circle: nullable(list(shape({ memberId: id, displayName: text, points: nullableNum }))),
  })(v);
