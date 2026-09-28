import { findActiveMember } from "../circle/circle.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDate } from "../time/local-date.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import {
  isReviewCadenceWeeks,
  isSeasonLengthWeeks,
  type ReviewCadenceWeeks,
  type Season,
  type SeasonLengthWeeks,
  type StartDateWindowError,
  validateStartDateWindow,
} from "./season.ts";

export interface EditSeasonParamsDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

export interface EditSeasonParamsInput {
  readonly seasonId: SeasonId;
  /** Raw IANA identifier, validated here via `TimeZone.isValidZone` (SC-6). Omit to keep the current value. */
  readonly timezone?: string;
  /** Raw "YYYY-MM-DD", validated here via `localDate` (A6). Omit to keep the current value. */
  readonly startDate?: string;
  readonly lengthWeeks?: SeasonLengthWeeks;
  readonly reviewCadenceWeeks?: ReviewCadenceWeeks;
}

export type EditSeasonParamsError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "PactNotOpen" }
  | { readonly kind: "InvalidTimezone" }
  | { readonly kind: "InvalidStartDate" }
  | StartDateWindowError
  | { readonly kind: "InvalidLengthWeeks" }
  | { readonly kind: "InvalidReviewCadenceWeeks" };

/**
 * Edits a season's timezone/startDate/lengthWeeks/reviewCadenceWeeks while
 * its pact is still open (B2, new SS-18) -- once the pact closes, every
 * parameter is locked (spec season-setup, "durante la temporada, los
 * parámetros quedan bloqueados"). Any active member of the circle may edit
 * -- no owner/admin role (A4), same as `rename-circle.ts`.
 *
 * SEAM (B2): editing is supposed to reset all pact approvals, same as
 * every other pre-close change (SS-13, CM-8). That reset has no effect to
 * wire yet -- `Season` doesn't carry an `approvals` array until the pact
 * module lands (S6); whichever slice adds it must also call the
 * approval-reset here, same pattern as `join-circle.ts`'s documented stub.
 * For now this use case only validates the new params and bumps
 * `version`.
 */
export async function editSeasonParams(
  deps: EditSeasonParamsDeps,
  actor: Actor,
  input: EditSeasonParamsInput,
): Promise<Result<Season, EditSeasonParamsError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Season, EditSeasonParamsError>> => {
    const season = await repos.seasons.get(input.seasonId);
    if (!season) {
      return err({ kind: "SeasonNotFound" });
    }

    const circle = await repos.circles.get(season.circleId);
    if (!circle || !findActiveMember(circle, actor.userId)) {
      return err({ kind: "NotAMember" });
    }

    if (season.status !== "pactOpen") {
      return err({ kind: "PactNotOpen" });
    }

    if (input.lengthWeeks !== undefined && !isSeasonLengthWeeks(input.lengthWeeks)) {
      return err({ kind: "InvalidLengthWeeks" });
    }
    if (input.reviewCadenceWeeks !== undefined && !isReviewCadenceWeeks(input.reviewCadenceWeeks)) {
      return err({ kind: "InvalidReviewCadenceWeeks" });
    }

    let timeZone = season.timeZone;
    if (input.timezone !== undefined) {
      if (!deps.timeZone.isValidZone(input.timezone)) {
        return err({ kind: "InvalidTimezone" });
      }
      timeZone = timeZoneId(input.timezone);
    }

    let nominalStart: LocalDate = season.nominalStart;
    if (input.startDate !== undefined) {
      try {
        nominalStart = localDate(input.startDate);
      } catch {
        return err({ kind: "InvalidStartDate" });
      }
    }

    // Re-validate the A6 window whenever `startDate` OR `timezone` changes
    // -- a new zone changes what "today" means for the SAME nominalStart
    // (SC-6), so it can push an unedited start date out of the window just
    // as much as editing the date itself would. Orthogonal fields (e.g.
    // `reviewCadenceWeeks` alone) skip this: re-checking an untouched
    // nominalStart/timezone pair on every unrelated edit would spuriously
    // reject a season whose original start date has since slipped into the
    // past while its pact stayed open.
    if (input.startDate !== undefined || input.timezone !== undefined) {
      const now = deps.clock.now();
      const today = deps.timeZone.localDateAt(now, timeZone);
      const windowError = validateStartDateWindow(nominalStart, today);
      if (windowError) {
        return err(windowError);
      }
    }

    const updated: Season = {
      ...season,
      timeZone,
      nominalStart,
      lengthWeeks: input.lengthWeeks ?? season.lengthWeeks,
      reviewCadenceWeeks: input.reviewCadenceWeeks ?? season.reviewCadenceWeeks,
      version: season.version + 1,
    };
    await repos.seasons.save(updated, season.version);
    return ok(updated);
  });
}
