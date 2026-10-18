import type { Circle } from "../circle/circle.ts";
import { dropSeasonEncouragements } from "../encouragement/erase.ts";
import type { EntryPhoto } from "../entry-photo/entry-photo.ts";
import { dropSeasonPhotos } from "../entry-photo/erase.ts";
import { dropCircleNotifications } from "../notifications/erase.ts";
import { dropSeasonPauses } from "../pause/erase.ts";
import type { Repositories } from "../ports/repositories.ts";
import { dropSeasonReactions } from "../reaction/erase.ts";
import { dropSeasonReminders } from "../reminders/erase.ts";
import { dropSeasonReviews } from "../review/erase.ts";
import { dropSeasonClosures } from "../season/closure/erase.ts";

/**
 * INSIDE the transaction (ADR-0019 E6): deletes the whole tree of a circle whose members are all
 * erased, in the order the foreign keys allow. Entries go first (they reference the photo ledger),
 * then the ledger, everything keyed by season, the seasons (commitments and approvals cascade) and
 * last the circle (invites, members, root). The caller holds the circle at the `version` it passes.
 * @returns the dropped photo rows: their objects must be deleted AFTER the commit.
 */
export async function hardDeleteCircle(
  repos: Repositories,
  circle: Circle,
): Promise<readonly EntryPhoto[]> {
  const seasons = await repos.seasons.listByCircle(circle.id);
  const seasonIds = seasons.map((season) => season.id);
  await repos.entries.deleteBySeasons(seasonIds);
  const dropped = await dropSeasonPhotos(repos, seasonIds);
  await dropSeasonPauses(repos, seasonIds);
  await dropSeasonReviews(repos, seasonIds);
  await dropSeasonClosures(repos, seasonIds);
  await dropCircleNotifications(repos, [circle.id]);
  await dropSeasonReminders(repos, seasonIds);
  await dropSeasonReactions(repos, seasonIds);
  await dropSeasonEncouragements(repos, seasonIds);
  for (const season of seasons) {
    await repos.seasons.delete(season.id, season.version);
  }
  await repos.circles.delete(circle.id, circle.version);
  return dropped;
}
