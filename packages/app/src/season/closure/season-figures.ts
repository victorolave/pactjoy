import type { MemberId } from "@pactjoy/engine";
import { seasonDay } from "@pactjoy/engine";
import type { StandingsRowView } from "../../score/standings.query.ts";
import type { LocalDate } from "../../time/local-date.ts";
import { localDateOfSeasonDay } from "../../time/season-calendar.ts";
import type { Season } from "../season.ts";

/** Where the viewer finished in a season: the ranking figures of screen 36 and of the history. */
export interface SeasonStandingView {
  /** Members with the same displayed points share a rank; `null` while everybody is at zero. */
  readonly rank: number | null;
  readonly memberCount: number;
  /** The member just above the viewer and how many points ahead they are; `null` for the leader. */
  readonly gap: { readonly displayName: string; readonly points: number } | null;
}

/** Derives the viewer's standing from the (peer-visible) standings rows. */
export function standingOf(
  rows: readonly StandingsRowView[],
  viewer: MemberId,
  memberCount: number,
): SeasonStandingView {
  const mine = rows.find((row) => row.memberId === viewer);
  const allZero = rows.every((row) => row.points === 0);
  if (mine === undefined || allZero) return { rank: null, memberCount, gap: null };
  const above = rows
    .filter((row) => row.points > mine.points)
    .sort((a, b) => a.points - b.points || a.displayName.localeCompare(b.displayName, "es"))[0];
  return {
    rank: mine.rank,
    memberCount,
    gap:
      above === undefined
        ? null
        : { displayName: above.displayName, points: above.points - mine.points },
  };
}

/** The civil date of the season's last day, or `null` while it has no start day. */
export function lastDayOf(season: Season): LocalDate | null {
  if (season.actualStart === null) return null;
  return localDateOfSeasonDay(seasonDay(season.lengthWeeks * 7 - 1), season.actualStart);
}
