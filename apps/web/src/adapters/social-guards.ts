import type { CircleFeedDto, ReactionsDto, SentEncouragementDto } from "../ports/wire.ts";

/**
 * Runtime checks for the social reads and writes (ADR-0018). Structure only: the app owns the
 * rules, this keeps a wrong or truncated 2xx from reaching a screen as data (it becomes
 * ApiError("Internal")). The feed is already masked for the viewer by the server; nothing here
 * decides what a peer may see.
 */

type Check = (value: unknown) => boolean;
type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id: Check = (v) => typeof v === "string" && v.length > 0;
const text: Check = (v) => typeof v === "string";
const bool: Check = (v) => typeof v === "boolean";
const count: Check = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const week: Check = (v) => typeof v === "number" && Number.isInteger(v) && v >= 1;
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
const shape =
  (fields: Readonly<Record<string, Check>>): Check =>
  (v) =>
    isRec(v) && Object.entries(fields).every(([key, check]) => check(v[key]));

const REACTION_CODES = ["heart", "raisedHands", "fire", "clap"] as const;
const UNITS = ["minutes", "hours", "times", "pages", "km", "glasses", "custom"] as const;
const PAUSE_REASONS = ["health", "travel", "work", "other"] as const;

const reactions: Check = shape({
  counts: shape(Object.fromEntries(REACTION_CODES.map((code) => [code, count]))),
  mine: nullable(oneOf(...REACTION_CODES)),
  reactable: bool,
});

const subject: Check = (v) =>
  isRec(v) &&
  (v.kind === "private" || (v.kind === "habit" && id(v.name) && nullable(text)(v.icon)));

const value: Check = shape({
  amount: id,
  unit: oneOf(...UNITS),
  customLabel: nullable(text),
});

const base = { key: id, onDate: id, at: nullable(text) } as const;

/** One check per `kind`; an unknown kind is rejected, so a server ahead of the client fails loudly. */
const itemChecks: Readonly<Record<string, Check>> = {
  completed: shape({ ...base, memberId: id, subject, value: nullable(value), reactions }),
  consistentWeek: shape({
    ...base,
    memberId: id,
    subject,
    week,
    kept: nullable(count),
    counted: nullable(count),
    reactions,
  }),
  comeback: shape({ ...base, memberId: id, reactions }),
  paused: shape({
    ...base,
    memberId: id,
    subjects: list(subject),
    reason: nullable(oneOf(...PAUSE_REASONS)),
    reactions,
  }),
  pointsRecalculated: shape({ ...base, memberId: id, subjects: list(subject) }),
  graduated: shape({ ...base, memberId: id, subject, reactions }),
  seasonStarted: shape({ ...base, lengthWeeks: week }),
  seasonClosed: shape(base),
  encouragementReceived: shape({ ...base, senderId: id, emoji: oneOf(...REACTION_CODES) }),
};

const item: Check = (v) => {
  if (!isRec(v) || typeof v.kind !== "string") return false;
  const check = itemChecks[v.kind];
  return check?.(v) === true;
};

const nudge: Check = shape({ seasonId: id, targetId: id, week, subject });

export const isCircleFeed = (data: unknown): data is CircleFeedDto =>
  shape({
    seasonId: nullable(id),
    members: list(shape({ id, displayName: text, isYou: bool, left: bool })),
    items: list(item),
    nextCursor: nullable(id),
    nudge: nullable(nudge),
  })(data);

export const isReactions = (data: unknown): data is ReactionsDto => reactions(data);

export const isSentEncouragement = (data: unknown): data is SentEncouragementDto =>
  shape({ recipientId: id, week })(data);
