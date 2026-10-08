export const todayKey = ["today"] as const;
export const habitsKey = ["habits"] as const;
export const seasonKey = (id: string) => ["season", id] as const;
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
