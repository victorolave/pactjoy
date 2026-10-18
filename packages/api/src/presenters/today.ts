import type {
  PendingYesterdayItem,
  StandingsView,
  TodayBase,
  TodayEntry,
  TodayOpportunity,
  TodayPause,
  TodayPoints,
  TodayRow,
  TodayView,
  TodayWeekProgress,
} from "@pactjoy/app";
import { presentMemberScore } from "./score.ts";

type Active = Extract<TodayView, { state: "active" | "ended" }>;

function presentBase(view: TodayBase): TodayBase {
  return {
    viewerId: view.viewerId,
    today: view.today,
    timeZone: view.timeZone,
    circle: { id: view.circle.id, name: view.circle.name },
    season: {
      id: view.season.id,
      lengthWeeks: view.season.lengthWeeks,
      nominalStart: view.season.nominalStart,
      actualStart: view.season.actualStart,
    },
    pendingReview:
      view.pendingReview === null
        ? null
        : {
            seasonId: view.pendingReview.seasonId,
            periodIndex: view.pendingReview.periodIndex,
            kind: view.pendingReview.kind,
            fullSrbai: view.pendingReview.fullSrbai,
            firstWeek: view.pendingReview.firstWeek,
            lastWeek: view.pendingReview.lastWeek,
            dueUntil: view.pendingReview.dueUntil,
            summaryAvailable: view.pendingReview.summaryAvailable,
          },
    baselineOffer:
      view.baselineOffer === null
        ? null
        : {
            seasonId: view.baselineOffer.seasonId,
            periodIndex: view.baselineOffer.periodIndex,
            offeredUntil: view.baselineOffer.offeredUntil,
          },
  };
}

/**
 * Not `presentEntry`: a `TodayEntry` is a slim view (no seasonId, memberId,
 * version, clientRequestId, ...), so it cannot be rebuilt into a `StoredEntry`.
 * Mapped field by field instead; the app already limits it to the viewer's own.
 */
function presentTodayEntry(entry: TodayEntry): TodayEntry {
  const { value } = entry;
  return {
    entryId: entry.entryId,
    forDate: entry.forDate,
    value:
      value.kind === "quantity" ? { kind: "quantity", value: value.value } : { kind: value.kind },
    note: entry.note,
    // Explicit whitelist (ADR-0011): `photoId` is an owner-only field and Today is the viewer's own;
    // no object key, size or state exists on the view to leak.
    photo:
      entry.photo === null
        ? null
        : { photoId: entry.photo.photoId, url: entry.photo.url, expiresAt: entry.photo.expiresAt },
  };
}

function presentOpportunity(opportunity: TodayOpportunity): TodayOpportunity {
  return { state: opportunity.state, graceUntil: opportunity.graceUntil };
}

function presentProgress(progress: TodayWeekProgress | null): TodayWeekProgress | null {
  if (progress === null) return null;
  return {
    value: progress.value,
    target: progress.target,
    sessionsDone: progress.sessionsDone,
    sessionsTarget: progress.sessionsTarget,
    percent: progress.percent,
  };
}

function presentPoints(points: TodayPoints): TodayPoints {
  return {
    perOpportunity: points.perOpportunity,
    perOpportunityExact:
      points.perOpportunityExact === null
        ? null
        : {
            numerator: points.perOpportunityExact.numerator,
            denominator: points.perOpportunityExact.denominator,
          },
    earned: points.earned,
    limitPercents: points.limitPercents === null ? null : [...points.limitPercents],
  };
}

function presentPending(item: PendingYesterdayItem): PendingYesterdayItem {
  return {
    commitmentId: item.commitmentId,
    habitName: item.habitName,
    privacy: item.privacy,
    measure: item.measure,
    forDate: item.forDate,
    graceUntil: item.graceUntil,
    points: presentPoints(item.points),
  };
}

function presentPause(pause: TodayPause | null): TodayPause | null {
  if (pause === null) return null;
  return {
    pauseRequestId: pause.pauseRequestId,
    status: pause.status,
    reason: pause.reason,
    endDate: pause.endDate,
    endsTomorrow: pause.endsTomorrow,
    canResume: pause.canResume,
    canCancel: pause.canCancel,
  };
}

function presentRow(row: TodayRow): TodayRow {
  const common = {
    commitmentId: row.commitmentId,
    habitName: row.habitName,
    privacy: row.privacy,
    measure: row.measure,
    opportunity: presentOpportunity(row.opportunity),
    points: presentPoints(row.points),
    entries: row.entries.map(presentTodayEntry),
    pause: presentPause(row.pause),
  };
  return row.kind === "day"
    ? { kind: "day", ...common, scheduledToday: row.scheduledToday }
    : { kind: "week", ...common, progress: presentProgress(row.progress) };
}

function presentRanked(view: Extract<StandingsView, { kind: "ranked" }>) {
  return {
    kind: "ranked" as const,
    rows: view.rows.map((row) => ({
      memberId: row.memberId,
      displayName: row.displayName,
      rank: row.rank,
      points: row.points,
    })),
    eligibleParticipantCount: view.eligibleParticipantCount,
  };
}

function presentActive(view: Active): Active {
  return {
    state: view.state,
    firstFullWeek: view.firstFullWeek ?? null,
    ...presentBase(view),
    summary: {
      week: view.summary.week,
      weekCount: view.summary.weekCount,
      daysLeft: view.summary.daysLeft,
      pointsToday: view.summary.pointsToday,
      score: presentMemberScore(view.summary.score),
    },
    rows: view.rows.map(presentRow),
    pendingYesterday: view.pendingYesterday.map(presentPending),
    standings: presentRanked(view.standings),
    seasonClose:
      view.seasonClose === null
        ? null
        : {
            step: view.seasonClose.step,
            resultsFrom: view.seasonClose.resultsFrom,
            nextSeasonFrom: view.seasonClose.nextSeasonFrom,
            nextSeasonOpen: view.seasonClose.nextSeasonOpen,
          },
  };
}

/**
 * Every field is emitted by name, so a field added to the app view is NOT
 * served until it is added here (ADR-0011); `userId` is never among them. That
 * the rows are only the viewer's own is decided by the app query (TD-R8), not
 * here. `measure` and the member score reuse the app's own projections.
 */
export function presentToday(view: TodayView): TodayView {
  switch (view.state) {
    case "noCircle":
      return { state: "noCircle" };
    case "noSeason":
      return { state: "noSeason", circle: { id: view.circle.id, name: view.circle.name } };
    case "pactOpen":
    case "notStarted":
      return {
        state: view.state,
        ...presentBase(view),
        myCommitments: view.myCommitments.map((c) => ({
          id: c.id,
          habitName: c.habitName,
          icon: c.icon,
          weightPercent: c.weightPercent,
          maxPoints: c.maxPoints,
        })),
      };
    case "active":
    case "ended":
      return presentActive(view);
  }
}
