export const todayKey = ["today"] as const;
/** The owner's reminder for one commitment (D2). Never persisted offline. */
export const reminderKey = (seasonId: string, commitmentId: string) =>
  ["reminder", seasonId, commitmentId] as const;
export const habitsKey = ["habits"] as const;
/** Every season read shares this root, so one invalidation refreshes them all. */
export const seasonsKey = ["season"] as const;
export const seasonKey = (id: string) => [...seasonsKey, id] as const;
export const scoringPreviewKey = (hash: string) => ["scoringPreview", hash] as const;
/** The viewer's circle for the Circle tab. Not persisted offline: a stale copy would show a circle the user left. */
export const myCircleKey = ["myCircle"] as const;
/** What a code leads to; one entry per code, enabled only at 6 characters. */
export const invitePreviewKey = (code: string) => ["invitePreview", code] as const;
/**
 * Season progress reads share one root, so a settled mutation or a season-day boundary refreshes
 * all of them at once. Never persisted offline; cleared with the rest when the session ends.
 */
export const progressKey = ["progress"] as const;
export const seasonProgressKey = (seasonId: string) =>
  [...progressKey, "season", seasonId] as const;
export const memberProgressKey = (seasonId: string, memberId: string) =>
  [...progressKey, "member", seasonId, memberId] as const;
export const commitmentProgressKey = (seasonId: string, commitmentId: string) =>
  [...progressKey, "commitment", seasonId, commitmentId] as const;
export const weekSummaryKey = (seasonId: string, weekIndex: number) =>
  [...progressKey, "week", seasonId, weekIndex] as const;
/**
 * The viewer's pause requests, the ones awaiting their answer, their budgets and the 30b comparison
 * (`GET /me/pause-requests`). Not persisted offline: a stale copy would show a decided request as
 * pending.
 */
export const pauseRequestsKey = ["pauseRequests"] as const;
/**
 * Every periodic review read (ADR-0014) shares this root. Owner-only and never persisted offline:
 * a stale copy would offer a review that was already saved.
 */
export const reviewsKey = ["review"] as const;
export const reviewKey = (seasonId: string, periodIndex: number) =>
  [...reviewsKey, seasonId, periodIndex] as const;
/** The owner's derived stage of one commitment; under the progress root so a settled mutation refreshes it. */
export const stageKey = (seasonId: string, commitmentId: string) =>
  [...progressKey, "stage", seasonId, commitmentId] as const;
/**
 * Every season close read (ADR-0015) shares this root: the final results (36), the carry-over
 * defaults for the next pact and the closed-season history. Owner-only and never persisted
 * offline: a stale copy would offer a closure that was already saved.
 */
export const seasonCloseKey = ["seasonClose"] as const;
export const seasonResultsKey = (seasonId: string) =>
  [...seasonCloseKey, "results", seasonId] as const;
export const carryOverKey = (seasonId: string) =>
  [...seasonCloseKey, "carryOver", seasonId] as const;
export const seasonHistoryKey = [...seasonCloseKey, "history"] as const;
/**
 * The Perfil summary (`GET /me/profile`): pooled consistency and the habit stages. Under the
 * progress root so every settled entry, pause, review, closure or pact mutation refreshes it.
 * Never persisted offline (only `["today"]` is), so the persisted cache version does not change.
 */
export const profileSummaryKey = [...progressKey, "profile"] as const;
/**
 * The social layer (ADR-0018): the circle activity feed, an infinite query whose first page also
 * carries the encouragement nudge. Its own root, NOT persisted offline (a stale feed would offer
 * a nudge already answered), so the persisted Today shape and its cache version do not change.
 */
export const socialKey = ["social"] as const;
export const feedKey = [...socialKey, "feed"] as const;
/** The mutation key of every reaction write, so the client can tell when reactions are in flight. */
export const reactionMutationKey = [...socialKey, "react"] as const;
