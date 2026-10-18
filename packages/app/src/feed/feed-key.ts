import type { CommitmentId, MemberId } from "@pactjoy/engine";
import type { EncouragementId, HabitId, PauseRequestId, SeasonId } from "../shared/ids.ts";

/**
 * The stable key of a feed item (ADR-0018, F3). It is built from ids and 1-BASED numbers only,
 * never from a name, a label or a value, and it is identical across reads while its source
 * exists. Reactions are stored under it, so THE FORMAT IS A COMPATIBILITY CONTRACT: changing it
 * orphans every stored reaction.
 *
 * The opportunity, not the entry, is the unit: a delete-and-relog of an entry keeps the same
 * `session:` key, so its reactions survive.
 */
export const MAX_FEED_KEY_LENGTH = 120;

/**
 * The shape every key has: a lowercase kind, then one or more `:`-separated segments of ids or
 * numbers. Ids are uuids in production; the readable ids of the test fixtures are accepted too.
 * The database check mirrors this (a stricter, hex-only variant is fine there, ids are uuids).
 */
const KEY_FORMAT = /^[a-z-]+(:[0-9A-Za-z-]+)+$/;
const POSITIVE_INT = /^[1-9]\d*$/;

/** What a key identifies, parsed. `day` and `week` are 1-based, as in the key itself. */
export type FeedItemKey =
  | { readonly kind: "session"; readonly commitmentId: CommitmentId; readonly day: number }
  | { readonly kind: "week"; readonly commitmentId: CommitmentId; readonly week: number }
  | { readonly kind: "comeback"; readonly memberId: MemberId; readonly day: number }
  | { readonly kind: "pause"; readonly pauseRequestId: PauseRequestId }
  | { readonly kind: "recalc"; readonly pauseRequestId: PauseRequestId }
  | { readonly kind: "graduation"; readonly habitId: HabitId }
  | { readonly kind: "seasonStart"; readonly seasonId: SeasonId }
  | { readonly kind: "seasonClose"; readonly seasonId: SeasonId }
  | { readonly kind: "encouragement"; readonly encouragementId: EncouragementId };

function checked(key: string): string {
  // The parser is the definition of a valid key: a builder never emits what it would reject.
  if (parseFeedItemKey(key) === null) {
    throw new RangeError(`feed key ${JSON.stringify(key)} breaks the key format`);
  }
  return key;
}

function positive(label: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`feed key: ${label} must be a positive integer, got ${value}`);
  }
  return value;
}

/** A per-session opportunity: `day` is the 1-based season day. */
export function sessionKey(commitment: CommitmentId, day: number): string {
  return checked(`session:${commitment}:${positive("day", day)}`);
}

/** A commitment's closed week: `week` is the 1-based season week. */
export function weekKey(commitment: CommitmentId, week: number): string {
  return checked(`week:${commitment}:${positive("week", week)}`);
}

/** A member's comeback on a 1-based season day. */
export function comebackKey(member: MemberId, day: number): string {
  return checked(`comeback:${member}:${positive("day", day)}`);
}

export function pauseKey(id: PauseRequestId): string {
  return checked(`pause:${id}`);
}

export function recalcKey(id: PauseRequestId): string {
  return checked(`recalc:${id}`);
}

export function graduationKey(habit: HabitId): string {
  return checked(`graduation:${habit}`);
}

export function seasonStartKey(season: SeasonId): string {
  return checked(`season-start:${season}`);
}

export function seasonCloseKey(season: SeasonId): string {
  return checked(`season-close:${season}`);
}

export function encouragementKey(id: EncouragementId): string {
  return checked(`encouragement:${id}`);
}

function number(part: string | undefined): number | null {
  return part !== undefined && POSITIVE_INT.test(part) ? Number(part) : null;
}

/**
 * The inverse of the builders, or `null` for anything that is not exactly a key of ours (an
 * unknown kind, a wrong number of parts, a day or week that is not a positive integer, the
 * superseded `entry:` form). The input may come from a URL, so nothing here throws.
 */
export function parseFeedItemKey(key: string): FeedItemKey | null {
  if (key.length > MAX_FEED_KEY_LENGTH || !KEY_FORMAT.test(key)) return null;
  const [kind, first, second, ...rest] = key.split(":");
  if (first === undefined || rest.length > 0) return null;
  switch (kind) {
    case "session":
    case "week":
    case "comeback": {
      const n = number(second);
      if (n === null) return null;
      if (kind === "session") return { kind, commitmentId: first as CommitmentId, day: n };
      if (kind === "week") return { kind, commitmentId: first as CommitmentId, week: n };
      return { kind, memberId: first as MemberId, day: n };
    }
    case "pause":
    case "recalc":
      return second === undefined ? { kind, pauseRequestId: first as PauseRequestId } : null;
    case "graduation":
      return second === undefined ? { kind, habitId: first as HabitId } : null;
    case "season-start":
      return second === undefined ? { kind: "seasonStart", seasonId: first as SeasonId } : null;
    case "season-close":
      return second === undefined ? { kind: "seasonClose", seasonId: first as SeasonId } : null;
    case "encouragement":
      return second === undefined ? { kind, encouragementId: first as EncouragementId } : null;
    default:
      return null;
  }
}
