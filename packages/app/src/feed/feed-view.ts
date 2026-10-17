import type { CommitmentId, MemberId, QuantityUnit } from "@pactjoy/engine";
import type { Circle, Member } from "../circle/circle.ts";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import type { Habit } from "../habit/habit.ts";
import type { PauseReason } from "../pause/pause-request.ts";
import type { FeedReaction, ReactionEmoji } from "../reaction/feed-reaction.ts";
import { emptyCounts, type Reactions, summarizeReactions } from "../reaction/reaction-counts.ts";
import { canSeeDetail } from "../score/privacy.ts";
import type { Season } from "../season/season.ts";
import { toDecimalString } from "../shared/decimal.ts";
import type { Instant } from "../time/instant.ts";
import type { LocalDate } from "../time/local-date.ts";
import { type FeedRecord, REACTABLE_KINDS } from "./feed-record.ts";

/**
 * What an item is about, as ONE viewer may see it (ADR-0018, F8, F9). A private habit is masked
 * for everyone but its owner, and so is a habit that cannot be found: when in doubt the item says
 * "un objetivo privado" (the Spanish copy lives in the client).
 */
export type FeedSubject =
  | { readonly kind: "habit"; readonly name: string; readonly icon: string | null }
  | { readonly kind: "private" };

/** A completed session's amount, on a commitment the viewer may see in detail. Decimal string, never a float. */
export interface FeedValue {
  readonly amount: string;
  readonly unit: QuantityUnit;
  /** The commitment's own label for a `custom` unit; `null` for the built-in units. */
  readonly customLabel: string | null;
}

interface FeedItemBase {
  readonly key: string;
  readonly onDate: LocalDate;
  readonly at: Instant | null;
}

/** One item of the feed for one viewer. A whitelist: a field not listed here cannot reach a peer. */
export type FeedItemView = FeedItemBase &
  (
    | {
        readonly kind: "completed";
        readonly memberId: MemberId;
        readonly subject: FeedSubject;
        readonly value: FeedValue | null;
        readonly reactions: Reactions;
      }
    | {
        readonly kind: "consistentWeek";
        readonly memberId: MemberId;
        readonly subject: FeedSubject;
        /** 1-based season week. */
        readonly week: number;
        /** The week's counts, only on a commitment the viewer may see in detail. */
        readonly kept: number | null;
        readonly counted: number | null;
        readonly reactions: Reactions;
      }
    | {
        readonly kind: "comeback";
        readonly memberId: MemberId;
        readonly reactions: Reactions;
      }
    | {
        readonly kind: "paused";
        readonly memberId: MemberId;
        readonly subjects: readonly FeedSubject[];
        /** `null` when every subject is private for the viewer. The pause note is never shown. */
        readonly reason: PauseReason | null;
        readonly reactions: Reactions;
      }
    | {
        readonly kind: "pointsRecalculated";
        readonly memberId: MemberId;
        readonly subjects: readonly FeedSubject[];
      }
    | {
        readonly kind: "graduated";
        readonly memberId: MemberId;
        readonly subject: FeedSubject;
        readonly reactions: Reactions;
      }
    | { readonly kind: "seasonStarted"; readonly lengthWeeks: number }
    | { readonly kind: "seasonClosed" }
    /** "X te envió 🙌": only the recipient is ever given this item, and it says nothing else. */
    | {
        readonly kind: "encouragementReceived";
        readonly senderId: MemberId;
        readonly emoji: ReactionEmoji;
      }
  );

export interface FeedViewInput {
  /** The records to show (a page), already in feed order. */
  readonly records: readonly FeedRecord[];
  readonly season: Season;
  readonly circle: Circle;
  /** At least the habits of the season's commitments. */
  readonly habits: readonly Habit[];
  readonly viewer: Member;
  /** Every stored reaction of the season. */
  readonly reactions: readonly FeedReaction[];
}

/** The commitment, but only when the viewer may see it in detail (`canSeeDetail`). */
function visibleCommitment(
  season: Season,
  id: CommitmentId,
  viewerId: MemberId,
): CommitmentRecord | null {
  const commitment = season.commitments.find((candidate) => candidate.id === id);
  return commitment !== undefined && canSeeDetail(commitment, viewerId) ? commitment : null;
}

/**
 * What the commitments are about, for ONE viewer: the habit's name and icon only when the viewer
 * may see EVERY one of them in detail; a private commitment, a missing one or a missing habit is
 * a private subject. Shared by the feed items and the nudge, so the mask is decided once.
 */
export function feedSubjectOf(
  season: Season,
  habits: readonly Habit[],
  viewerId: MemberId,
  commitmentIds: readonly CommitmentId[],
): FeedSubject {
  const visible = commitmentIds.map((id) => visibleCommitment(season, id, viewerId));
  const first = visible[0];
  if (first === undefined || first === null || visible.some((c) => c === null)) {
    return { kind: "private" };
  }
  const habit = habits.find((candidate) => candidate.id === first.habitId);
  return habit === undefined
    ? { kind: "private" }
    : { kind: "habit", name: habit.name, icon: habit.icon };
}

/**
 * Presents the records of a page for ONE viewer (ADR-0018, F8, F9, F12). Everything a peer must
 * not see is decided here and nowhere else: a private or unknown commitment becomes a private
 * subject and loses its value and week counts; a left member's items are not reactable and show
 * no counts; reactor identities never appear. Nothing here writes.
 */
export function presentFeedItems(input: FeedViewInput): FeedItemView[] {
  const { season, circle, viewer } = input;
  const activeIds = new Set(circle.members.filter((m) => m.status === "active").map((m) => m.id));

  function subjectOf(commitmentIds: readonly CommitmentId[]): FeedSubject {
    return feedSubjectOf(season, input.habits, viewer.id, commitmentIds);
  }

  function reactionsOf(key: string, owner: MemberId, kind: FeedRecord["kind"]): Reactions {
    // A member who left keeps their items but they are frozen: no counts, no reacting (REQ-R6).
    if (!activeIds.has(owner)) {
      return { counts: emptyCounts(), mine: null, reactable: false };
    }
    const { counts, mine } = summarizeReactions({
      itemKey: key,
      reactions: input.reactions,
      viewerId: viewer.id,
      activeMemberIds: activeIds,
    });
    return {
      counts,
      mine,
      reactable: owner !== viewer.id && REACTABLE_KINDS.includes(kind),
    };
  }

  function present(record: FeedRecord): FeedItemView {
    const { key, onDate, at } = record;
    switch (record.kind) {
      case "completed": {
        const commitment = visibleCommitment(season, record.commitmentId, viewer.id);
        const value =
          commitment !== null && record.amount !== null && commitment.measure.unit !== "done"
            ? {
                amount: toDecimalString(record.amount),
                unit: commitment.measure.unit,
                customLabel: commitment.measure.customLabel,
              }
            : null;
        return {
          kind: "completed",
          key,
          onDate,
          at,
          memberId: record.memberId,
          subject: subjectOf([record.commitmentId]),
          value,
          reactions: reactionsOf(key, record.memberId, record.kind),
        };
      }
      case "consistentWeek": {
        const detail = visibleCommitment(season, record.commitmentId, viewer.id) !== null;
        return {
          kind: "consistentWeek",
          key,
          onDate,
          at,
          memberId: record.memberId,
          subject: subjectOf([record.commitmentId]),
          week: record.week,
          kept: detail ? record.kept : null,
          counted: detail ? record.counted : null,
          reactions: reactionsOf(key, record.memberId, record.kind),
        };
      }
      case "comeback":
        return {
          kind: "comeback",
          key,
          onDate,
          at,
          memberId: record.memberId,
          reactions: reactionsOf(key, record.memberId, record.kind),
        };
      case "paused": {
        const subjects = record.commitmentIds.map((id) => subjectOf([id]));
        return {
          kind: "paused",
          key,
          onDate,
          at,
          memberId: record.memberId,
          subjects,
          reason: subjects.every((s) => s.kind === "private") ? null : record.reason,
          reactions: reactionsOf(key, record.memberId, record.kind),
        };
      }
      case "pointsRecalculated":
        return {
          kind: "pointsRecalculated",
          key,
          onDate,
          at,
          memberId: record.memberId,
          subjects: record.commitmentIds.map((id) => subjectOf([id])),
        };
      case "graduated":
        return {
          kind: "graduated",
          key,
          onDate,
          at,
          memberId: record.memberId,
          subject: subjectOf(record.commitmentIds),
          reactions: reactionsOf(key, record.memberId, record.kind),
        };
      case "seasonStarted":
        return { kind: "seasonStarted", key, onDate, at, lengthWeeks: record.lengthWeeks };
      case "seasonClosed":
        return { kind: "seasonClosed", key, onDate, at };
      case "encouragementReceived":
        return {
          kind: "encouragementReceived",
          key,
          onDate,
          at,
          senderId: record.senderId,
          emoji: record.emoji,
        };
    }
  }

  return input.records.map(present);
}
