import type { CommitmentId, MemberId, Streak } from "@pactjoy/engine";
import type { MeasureView } from "../score/commitment-projection.ts";
import type { PreviewProgressView } from "../scoring/preview-progress.query.ts";
import type { SeasonLengthWeeks } from "../season/season.ts";
import type { CircleId, SeasonId } from "../shared/ids.ts";
import type { LocalDate } from "../time/local-date.ts";
import type { TimeZoneId } from "../time/time-zone.port.ts";
import type { TodayEntry, TodayWeekProgress } from "../today/today-rows.ts";

/**
 * The four season progress read models (change pwa-season-progress). Every
 * view is JSON-safe: points and percents are already rounded by the engine's
 * display boundary, thresholds are decimal strings, ids are MemberId /
 * CommitmentId (never UserId) and `null` means "nothing counted yet", never 0.
 * One captured instant governs a whole view.
 */

export interface ProgressSeason {
  readonly id: SeasonId;
  readonly timeZone: TimeZoneId;
  readonly lengthWeeks: SeasonLengthWeeks;
  readonly actualStart: LocalDate;
  readonly lastDay: LocalDate;
}

export interface ProgressCalendar {
  /** The real season-local day of the captured instant; scoring uses it even after the end. */
  readonly today: LocalDate;
  /** 0-based week shown (UI shows +1); clamped to the last week after the end. */
  readonly weekIndex: number;
  /** 1-based day of that week; clamped like `weekIndex`. */
  readonly dayOfWeek: number;
  /** Days after today that still belong to the season; `0` on the last day and after it. */
  readonly daysLeft: number;
}

/** Started views share these; a season without `actualStart` yields `{ state: "notStarted" }`. */
interface StartedBase {
  readonly state: "active" | "ended";
  readonly viewerId: MemberId;
  readonly season: ProgressSeason;
  readonly calendar: ProgressCalendar;
}

export type NotStartedProgress = { readonly state: "notStarted"; readonly seasonId: SeasonId };

export interface ProgressMetrics {
  readonly points: number;
  readonly consistency: number | null;
  readonly idealCompletion: number | null;
}

/** Engine pause facts for today's opportunity; nothing about a pause workflow. */
export type ProgressPauseStatus = "none" | "paused" | "onHold";

/** A commitment its viewer may fully see: their own, or a peer's `visible` one. */
export interface CommitmentProgressRow extends ProgressMetrics {
  readonly kind: "detail";
  readonly commitmentId: CommitmentId;
  readonly habit: { readonly name: string; readonly icon: string | null };
  readonly weightPercent: number;
  readonly privacy: "visible" | "private";
  readonly measure: MeasureView;
  /** Opportunities counted so far, and how many of them reached the minimum. */
  readonly opportunities: { readonly kept: number; readonly counted: number };
  readonly streak: Streak;
  readonly pause: ProgressPauseStatus;
}

/** A peer's `private` commitment: EXACTLY these four fields (SQ-2). */
export interface HiddenCommitmentRow {
  readonly kind: "hidden";
  readonly commitmentId: CommitmentId;
  readonly weightPercent: number;
  readonly points: number;
}

export interface StandingsEntry {
  readonly memberId: MemberId;
  readonly displayName: string;
  readonly isViewer: boolean;
  /** Competition rank on displayed points; `null` while every row shows 0 (alphabetical, unnumbered). */
  readonly rank: number | null;
  readonly points: number;
}

/** Whether a week's opportunities are counted, still editable and final: independent facts. */
export interface WeekFacts {
  readonly counted: boolean;
  readonly editable: boolean;
  readonly final: boolean;
}

export interface WeekRange {
  readonly weekIndex: number;
  readonly start: LocalDate;
  readonly end: LocalDate;
  readonly timing: "past" | "current" | "future";
  readonly facts: WeekFacts;
}

/** Counted points only: a weekly-window opportunity adds nothing before close plus grace. */
export interface SeasonWeek extends WeekRange {
  /** One per standings member; metrics are `null` for a future week. */
  readonly members: readonly {
    readonly memberId: MemberId;
    readonly points: number | null;
    readonly consistency: number | null;
    readonly idealCompletion: number | null;
  }[];
}

export type SeasonProgressView =
  | NotStartedProgress
  | (StartedBase & {
      readonly circle: { readonly id: CircleId; readonly name: string };
      readonly own: ProgressMetrics & { readonly commitments: readonly CommitmentProgressRow[] };
      /** Leavers excluded; in display order. Solo, pair or 3–6 is decided from `memberCount`. */
      readonly standings: {
        readonly memberCount: number;
        readonly rows: readonly StandingsEntry[];
      };
      /** Every week of the season, in order. */
      readonly weeks: readonly SeasonWeek[];
    });

/** Peer metrics aggregate ALL commitments, private ones included (owner decision, Notion). */
export type MemberProgressView =
  | NotStartedProgress
  | (StartedBase &
      ProgressMetrics & {
        readonly member: { readonly memberId: MemberId; readonly displayName: string };
      } & (
        | { readonly scope: "own"; readonly commitments: readonly CommitmentProgressRow[] }
        | {
            readonly scope: "others";
            readonly commitments: readonly (CommitmentProgressRow | HiddenCommitmentRow)[];
          }
      ));

/** An authorized entry behind a history cell; no entry id, request id or tombstone. */
export interface ProgressEvidence {
  readonly forDate: LocalDate;
  readonly recordedOn: LocalDate;
  readonly value: TodayEntry["value"];
  readonly note: string | null;
}

/**
 * One engine opportunity. `ideal`/`minimum`/`below` are counted outcomes (for
 * `limit`, `minimum` means within tolerance); `missed` is an explicit "Hoy no
 * salió" and `unrecorded` a counted opportunity with no entry. `pending` is
 * not counted yet, `future` has not started.
 */
export interface HistoryCell {
  readonly kind: "day" | "session" | "week";
  /** The scheduled day (`day`), the source day (`session`), `null` for a week or an unfilled slot. */
  readonly date: LocalDate | null;
  readonly status:
    | "ideal"
    | "minimum"
    | "below"
    | "missed"
    | "unrecorded"
    | "pending"
    | "future"
    | "paused"
    | "onHold";
  readonly progressPercent: number | null;
  /** Recorded after its day (within the window); never a penalty. */
  readonly late: boolean;
  readonly evidence: readonly ProgressEvidence[];
}

export type CommitmentProgressView =
  | NotStartedProgress
  | (StartedBase & {
      readonly memberId: MemberId;
      readonly commitment: CommitmentProgressRow;
      readonly weeks: readonly (WeekRange & {
        readonly status: "scored" | "paused" | "onHold";
        readonly sessionsDone: number;
        readonly sessionsTarget: number;
        readonly cells: readonly HistoryCell[];
      })[];
      /** Engine-backed "Cómo puntúa": `curve` is `null` for done / not done. */
      readonly scoring: {
        readonly perOpportunityPoints: string | null;
        readonly opportunityCount: number;
        readonly curve: PreviewProgressView["rows"] | null;
      };
    });

/** The viewer's own week (25b/25c); recomputed live, never a snapshot. */
export interface WeekSummaryView extends WeekRange, ProgressMetrics {
  readonly viewerId: MemberId;
  readonly season: ProgressSeason;
  /** `best`: displayed points beat EVERY prior counted week (never week 1); `difficult`: consistency < 50 %. */
  readonly headline: "best" | "difficult" | null;
  readonly weeksLeft: number;
  readonly commitments: readonly {
    readonly commitmentId: CommitmentId;
    readonly habit: { readonly name: string; readonly icon: string | null };
    readonly measure: MeasureView;
    readonly points: number | null;
    /** `null` while the whole week is paused or on hold. */
    readonly progress: TodayWeekProgress | null;
  }[];
  /** Weekly points per member, only when the circle has exactly two; no ranking. */
  readonly circle:
    | readonly {
        readonly memberId: MemberId;
        readonly displayName: string;
        readonly points: number | null;
      }[]
    | null;
}
