import type { CommitmentProgress, MemberProgress, SeasonProgress, WeekSummary } from "./wire.ts";

/**
 * The season progress reads, standalone until the transport lands (change
 * pwa-season-progress). Ids are MemberId / CommitmentId; `weekIndex` is
 * 0-based. Adapters throw `ApiError`.
 */
export interface SeasonProgressApi {
  getSeasonProgress(seasonId: string, signal?: AbortSignal): Promise<SeasonProgress>;
  getMemberProgress(
    seasonId: string,
    memberId: string,
    signal?: AbortSignal,
  ): Promise<MemberProgress>;
  getCommitmentProgress(
    seasonId: string,
    commitmentId: string,
    signal?: AbortSignal,
  ): Promise<CommitmentProgress>;
  getWeekSummary(seasonId: string, weekIndex: number, signal?: AbortSignal): Promise<WeekSummary>;
}
