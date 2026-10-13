import { Standings } from "../../season/index.ts";
import { useSeasonProgress } from "../../season-progress-data/index.ts";
import { finalStandingsFootnote } from "../close-format.ts";
import { resultsCopy } from "../copy.ts";

/**
 * 36: the final ranking, the same rows the season progress shows (peer-visible names and points),
 * with the gap between first and second under the list. It reads the season's progress, so it
 * waits for it and, if that cannot be read, leaves the card out rather than the whole screen.
 */
export function FinalStandings({ seasonId }: { readonly seasonId: string }) {
  const query = useSeasonProgress(seasonId);
  const progress = query.data;
  if (progress === undefined || !("standings" in progress)) return null;
  return (
    <Standings
      title={resultsCopy.standings}
      standings={progress.standings}
      season={progress.season}
      calendar={progress.calendar}
      footer={finalStandingsFootnote(progress.standings.rows.map((row) => row.points))}
    />
  );
}
