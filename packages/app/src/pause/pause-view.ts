import type { CommitmentId, MemberId, SeasonDay } from "@pactjoy/engine";
import type { Circle } from "../circle/circle.ts";
import type { Habit } from "../habit/habit.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Season } from "../season/season.ts";
import type { HabitId, PauseRequestId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDateOfSeasonDay } from "../time/season-calendar.ts";
import { approversOf } from "./effective-pauses.ts";
import type {
  PauseReason,
  PauseRequestRecord,
  PauseResponseChoice,
  PauseStatus,
} from "./pause-request.ts";

export interface PauseViewDeps {
  readonly uow: UnitOfWork<Repositories>;
}

/** One Commitment of the viewer's OWN request: everything about it is theirs to see. */
export interface PauseCommitmentOwnView {
  readonly commitmentId: CommitmentId;
  readonly habitName: string;
  readonly icon: string | null;
  /** The day it was resumed early, if it was. */
  readonly resumedOn: LocalDate | null;
}

/** The requester's projection of their request (D1, PA-1). */
export interface PauseRequestView {
  readonly id: PauseRequestId;
  readonly status: PauseStatus;
  readonly reason: PauseReason;
  readonly note: string | null;
  readonly startDate: LocalDate;
  /** `null` for an open pause. */
  readonly endDate: LocalDate | null;
  readonly requestedAt: Instant;
  readonly autoApproveAt: Instant;
  readonly decidedAt: Instant | null;
  readonly commitments: readonly PauseCommitmentOwnView[];
  readonly approvers: readonly {
    readonly memberId: MemberId;
    readonly displayName: string;
    readonly response: PauseResponseChoice | null;
  }[];
}

/**
 * A Commitment of someone else's request as an approver sees it. A PRIVATE
 * Commitment is exactly `{kind: "hidden", commitmentId}`: no habit, no icon,
 * no measure (Q15, PS-S5).
 */
export type PauseCommitmentApprovalView =
  | {
      readonly kind: "visible";
      readonly commitmentId: CommitmentId;
      readonly habitName: string;
      readonly icon: string | null;
    }
  | { readonly kind: "hidden"; readonly commitmentId: CommitmentId };

/** The approver's projection of a request they are asked about (D1, PA-2). */
export interface PauseApprovalView {
  readonly id: PauseRequestId;
  readonly status: PauseStatus;
  readonly reason: PauseReason;
  /** Shown to approvers (Q10). */
  readonly note: string | null;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate | null;
  readonly requestedAt: Instant;
  readonly autoApproveAt: Instant;
  readonly requester: { readonly memberId: MemberId; readonly displayName: string };
  /** The viewer's current answer; `null` until they answer. */
  readonly myResponse: PauseResponseChoice | null;
  readonly commitments: readonly PauseCommitmentApprovalView[];
}

interface Resolved {
  readonly season: Season;
  readonly circle: Circle;
  readonly habits: ReadonlyMap<HabitId, Habit>;
}

/** Everything a projection needs to name things, loaded once per request's season. */
async function resolveAll(
  repos: Repositories,
  records: readonly PauseRequestRecord[],
): Promise<ReadonlyMap<PauseRequestId, Resolved>> {
  const seasons = new Map<string, Resolved>();
  const out = new Map<PauseRequestId, Resolved>();
  for (const record of records) {
    let resolved = seasons.get(record.seasonId);
    if (!resolved) {
      const season = await repos.seasons.get(record.seasonId);
      const circle = season ? await repos.circles.get(season.circleId) : null;
      if (!season || !circle) throw new Error(`season ${record.seasonId} of a pause is gone`);
      const habits = await repos.habits.getMany(season.commitments.map((c) => c.habitId));
      resolved = { season, circle, habits: new Map(habits.map((h) => [h.id, h])) };
      seasons.set(record.seasonId, resolved);
    }
    out.set(record.id, resolved);
  }
  return out;
}

function dateOf(season: Season, day: SeasonDay): LocalDate {
  if (season.actualStart === null) throw new Error(`season ${season.id} has no actual start`);
  return localDateOfSeasonDay(day, season.actualStart);
}

function datesOf(season: Season, record: PauseRequestRecord) {
  return {
    startDate: dateOf(season, record.startDay),
    endDate: record.end.kind === "fixed" ? dateOf(season, record.end.lastDay) : null,
  };
}

function displayNameOf(circle: Circle, memberId: MemberId): string {
  const member = circle.members.find((m) => m.id === memberId);
  if (!member) throw new Error(`member ${memberId} of a pause is not in circle ${circle.id}`);
  return member.displayName;
}

function habitOf(resolved: Resolved, commitmentId: CommitmentId) {
  const commitment = resolved.season.commitments.find((c) => c.id === commitmentId);
  if (!commitment) throw new Error(`commitment ${commitmentId} of a pause is gone`);
  const habit = resolved.habits.get(commitment.habitId);
  if (!habit) throw new Error(`habit ${commitment.habitId} of commitment ${commitmentId} is gone`);
  return { commitment, habit };
}

/**
 * The requester's projection of their own requests, in one read. Access is
 * not decided here: the caller passes records it already authorized (a use
 * case result, or the viewer's own `mine`).
 */
export async function pauseRequestViews(
  deps: PauseViewDeps,
  records: readonly PauseRequestRecord[],
): Promise<readonly PauseRequestView[]> {
  return deps.uow.read(async (repos) => {
    const resolved = await resolveAll(repos, records);
    return records.map((record): PauseRequestView => {
      const context = resolved.get(record.id);
      if (!context) throw new Error("unreachable: every record was resolved");
      const { season, circle } = context;
      return {
        id: record.id,
        status: record.status,
        reason: record.reason,
        note: record.note,
        ...datesOf(season, record),
        requestedAt: record.requestedAt,
        autoApproveAt: record.autoApproveAt,
        decidedAt: record.decidedAt,
        commitments: record.commitments.map((item) => {
          const { habit } = habitOf(context, item.commitmentId);
          return {
            commitmentId: item.commitmentId,
            habitName: habit.name,
            icon: habit.icon,
            resumedOn: item.resumedOn === null ? null : dateOf(season, item.resumedOn),
          };
        }),
        approvers: approversOf(circle, record.memberId).map((memberId) => ({
          memberId,
          displayName: displayNameOf(circle, memberId),
          response: record.responses.find((r) => r.memberId === memberId)?.response ?? null,
        })),
      };
    });
  });
}

/** The approver's projection of requests asked of them, with a private Commitment hidden. */
export async function pauseApprovalViews(
  deps: PauseViewDeps,
  items: readonly {
    readonly request: PauseRequestRecord;
    readonly myResponse: PauseResponseChoice | null;
  }[],
): Promise<readonly PauseApprovalView[]> {
  return deps.uow.read(async (repos) => {
    const resolved = await resolveAll(
      repos,
      items.map((item) => item.request),
    );
    return items.map(({ request, myResponse }): PauseApprovalView => {
      const context = resolved.get(request.id);
      if (!context) throw new Error("unreachable: every record was resolved");
      const { season, circle } = context;
      return {
        id: request.id,
        status: request.status,
        reason: request.reason,
        note: request.note,
        ...datesOf(season, request),
        requestedAt: request.requestedAt,
        autoApproveAt: request.autoApproveAt,
        requester: {
          memberId: request.memberId,
          displayName: displayNameOf(circle, request.memberId),
        },
        myResponse,
        commitments: request.commitments.map((item): PauseCommitmentApprovalView => {
          const { commitment, habit } = habitOf(context, item.commitmentId);
          return commitment.privacy === "private"
            ? { kind: "hidden", commitmentId: item.commitmentId }
            : {
                kind: "visible",
                commitmentId: item.commitmentId,
                habitName: habit.name,
                icon: habit.icon,
              };
        }),
      };
    });
  });
}
