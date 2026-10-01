import type { MemberId } from "@pactjoy/engine";
import type { Circle } from "../circle/circle.ts";
import { findActiveMember } from "../circle/circle.ts";
import type { CommitmentRecord } from "../commitment/commitment.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { EntryId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import type { EntryRecord } from "./entry.ts";
import { checkEntryWindow, type EntryWindowError } from "./entry-window.ts";

export type OwnEntryError =
  | { readonly kind: "EntryNotFound" }
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "EntryNotOwned" }
  | { readonly kind: "EntryDeleted" }
  | { readonly kind: "SeasonNotActive" }
  | { readonly kind: "BeforeSeasonStart" }
  | EntryWindowError;

/** Everything an edit or delete needs, already checked. */
export interface OwnEntryContext {
  readonly entry: EntryRecord;
  readonly season: Season;
  readonly circle: Circle;
  readonly commitment: CommitmentRecord;
  /** The actor's own member id, resolved in the same transaction (== `entry.memberId`). */
  readonly memberId: MemberId;
}

/**
 * The checks edit and delete share (ER-10..ER-13, ER-18): the entry belongs
 * to an active member who is the actor (B9: a member who left can't change
 * their past entries), its season is active and its window is still open
 * (A9/B8: the day's own grace for a day-bound entry, the week's close plus
 * grace for a week-bound one). An entry whose commitment is gone from the
 * season is reported as not found: nothing can be checked against it.
 */
export async function loadMutableEntry(
  deps: { readonly clock: Clock; readonly timeZone: TimeZone },
  repos: Repositories,
  actor: Actor,
  id: EntryId,
): Promise<Result<OwnEntryContext, OwnEntryError>> {
  const entry = await repos.entries.getStored(id);
  if (!entry) {
    return err({ kind: "EntryNotFound" });
  }
  const season = await repos.seasons.get(entry.seasonId);
  if (!season) {
    return err({ kind: "SeasonNotFound" });
  }
  const circle = await repos.circles.get(season.circleId);
  const member = circle ? findActiveMember(circle, actor.userId) : undefined;
  if (!circle || !member) {
    return err({ kind: "NotAMember" });
  }
  if (entry.memberId !== member.id) {
    return err({ kind: "EntryNotOwned" });
  }
  // Only the owner learns that an entry is gone: anyone else got EntryNotOwned above.
  if (entry.deleted) {
    return err({ kind: "EntryDeleted" });
  }
  const commitment = season.commitments.find((candidate) => candidate.id === entry.commitmentId);
  if (!commitment) {
    return err({ kind: "EntryNotFound" });
  }
  if (season.status !== "active" || season.actualStart === null) {
    return err({ kind: "SeasonNotActive" });
  }

  const todayDate = deps.timeZone.localDateAt(deps.clock.now(), season.timeZone);
  const today = toSeasonDay(todayDate, season.actualStart);
  if (today.kind === "beforeStart") {
    return err({ kind: "BeforeSeasonStart" });
  }
  const closed = checkEntryWindow({
    schedule: commitment.measure.schedule,
    day: entry.day,
    today: today.day,
    lengthWeeks: season.lengthWeeks,
    // B7: the real extension source arrives with change A2 (app-pause-workflow).
    pauseGraceExtensionDays: 0,
  });
  return closed ? err(closed) : ok({ entry, season, circle, commitment, memberId: member.id });
}
