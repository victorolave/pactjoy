import type {
  CommitmentProgressView,
  MemberProgressView,
  SeasonProgressView,
  WeekSummaryView,
} from "@pactjoy/app";

/**
 * Wire contracts of the four progress reads (change pwa-season-progress). The
 * app views are already JSON-safe, so each DTO is the view itself; the
 * presenter of each endpoint lands with its route and must emit every field
 * by name (ADR-0011), so nothing unlisted is served.
 */
export type SeasonProgressDto = SeasonProgressView;
export type MemberProgressDto = MemberProgressView;
export type CommitmentProgressDto = CommitmentProgressView;
export type WeekSummaryDto = WeekSummaryView;
