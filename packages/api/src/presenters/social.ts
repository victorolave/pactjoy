import type {
  CircleFeed,
  FeedItemView,
  FeedMember,
  FeedSubject,
  FeedValue,
  NudgeSuggestion,
  Reactions,
  SendEncouragementResult,
} from "@pactjoy/app";
import { presentInstantOrNull } from "./time.ts";

/**
 * Every field is emitted by name (ADR-0011 Q25, ADR-0018): a field added to an app view is NOT
 * served until it is added here. The social wire carries NO reactor id, no version, no `sentOn`,
 * no dismissal and no user id; a private subject is exactly `{kind: "private"}` and a quantity is a
 * decimal string. The app views are already masked for the viewer: this is the second lock.
 */
function presentSubject(subject: FeedSubject) {
  return subject.kind === "habit"
    ? { kind: "habit" as const, name: subject.name, icon: subject.icon }
    : { kind: "private" as const };
}

function presentValue(value: FeedValue | null) {
  return value === null
    ? null
    : { amount: value.amount, unit: value.unit, customLabel: value.customLabel };
}

/** Counts only, one entry per emoji code (the glyphs live in the client); who reacted is never served. */
export function presentReactions(reactions: Reactions) {
  return {
    counts: {
      heart: reactions.counts.heart,
      raisedHands: reactions.counts.raisedHands,
      fire: reactions.counts.fire,
      clap: reactions.counts.clap,
    },
    mine: reactions.mine,
    reactable: reactions.reactable,
  };
}

function presentItem(item: FeedItemView) {
  const base = { key: item.key, onDate: item.onDate, at: presentInstantOrNull(item.at) };
  switch (item.kind) {
    case "completed":
      return {
        ...base,
        kind: item.kind,
        memberId: item.memberId,
        subject: presentSubject(item.subject),
        value: presentValue(item.value),
        reactions: presentReactions(item.reactions),
      };
    case "consistentWeek":
      return {
        ...base,
        kind: item.kind,
        memberId: item.memberId,
        subject: presentSubject(item.subject),
        week: item.week,
        kept: item.kept,
        counted: item.counted,
        reactions: presentReactions(item.reactions),
      };
    case "comeback":
      return {
        ...base,
        kind: item.kind,
        memberId: item.memberId,
        reactions: presentReactions(item.reactions),
      };
    case "paused":
      return {
        ...base,
        kind: item.kind,
        memberId: item.memberId,
        subjects: item.subjects.map(presentSubject),
        reason: item.reason,
        reactions: presentReactions(item.reactions),
      };
    case "pointsRecalculated":
      return {
        ...base,
        kind: item.kind,
        memberId: item.memberId,
        subjects: item.subjects.map(presentSubject),
      };
    case "graduated":
      return {
        ...base,
        kind: item.kind,
        memberId: item.memberId,
        subject: presentSubject(item.subject),
        reactions: presentReactions(item.reactions),
      };
    case "seasonStarted":
      return { ...base, kind: item.kind, lengthWeeks: item.lengthWeeks };
    case "seasonClosed":
      return { ...base, kind: item.kind };
    case "encouragementReceived":
      return { ...base, kind: item.kind, senderId: item.senderId, emoji: item.emoji };
  }
}

function presentMember(member: FeedMember) {
  return {
    id: member.id,
    displayName: member.displayName,
    isYou: member.isYou,
    left: member.left,
  };
}

function presentNudge(nudge: NudgeSuggestion) {
  return {
    seasonId: nudge.seasonId,
    targetId: nudge.targetId,
    week: nudge.week,
    subject: presentSubject(nudge.subject),
  };
}

export function presentCircleFeed(feed: CircleFeed) {
  return {
    seasonId: feed.seasonId,
    members: feed.members.map(presentMember),
    items: feed.items.map(presentItem),
    nextCursor: feed.nextCursor,
    nudge: feed.nudge === null ? null : presentNudge(feed.nudge),
  };
}

/** What the sender needs to settle the card: who and which week. The row itself is never echoed. */
export function presentSentEncouragement(result: SendEncouragementResult) {
  return { recipientId: result.recipientId, week: result.week };
}

/** A dismissal answers with an empty object; nothing about it is served. */
export function presentDismissedNudge() {
  return {};
}
