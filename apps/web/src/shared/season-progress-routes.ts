const segment = encodeURIComponent;

function weekSegment(weekIndex: number): string {
  if (!Number.isInteger(weekIndex) || weekIndex < 0) {
    throw new RangeError(`week index must be a non-negative integer, got ${weekIndex}`);
  }
  return String(weekIndex);
}

/** Screen paths of season progress; `weekIndex` is 0-based (the UI shows it + 1). */
export const progressRoutes = {
  overview: "/season",
  member: (seasonId: string, memberId: string) =>
    `/season/${segment(seasonId)}/members/${segment(memberId)}`,
  commitment: (seasonId: string, commitmentId: string) =>
    `/season/${segment(seasonId)}/commitments/${segment(commitmentId)}`,
  week: (seasonId: string, weekIndex: number) =>
    `/season/${segment(seasonId)}/weeks/${weekSegment(weekIndex)}/summary`,
} as const;

/** The same screens as router patterns, relative to the app root. */
export const progressRoutePatterns = {
  member: "season/:seasonId/members/:memberId",
  commitment: "season/:seasonId/commitments/:commitmentId",
  week: "season/:seasonId/weeks/:weekIndex/summary",
} as const;

/** The four API paths reserved for the progress reads (all GET). */
export const progressApiPaths = {
  season: (seasonId: string) => `/seasons/${segment(seasonId)}/progress`,
  member: (seasonId: string, memberId: string) =>
    `/seasons/${segment(seasonId)}/members/${segment(memberId)}/progress`,
  commitment: (seasonId: string, commitmentId: string) =>
    `/seasons/${segment(seasonId)}/commitments/${segment(commitmentId)}/progress`,
  week: (seasonId: string, weekIndex: number) =>
    `/seasons/${segment(seasonId)}/weeks/${weekSegment(weekIndex)}/summary`,
} as const;
