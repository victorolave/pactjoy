import { findActiveMember } from "../circle/circle.ts";
import { resetApprovals } from "../pact/reset-approvals.ts";
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
  type SeasonMutationResult,
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

export type EditSeasonParamsResult = Result<SeasonMutationResult, EditSeasonParamsError>;

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
 * Editing resets all pact approvals (B2, PA-2): members approved the
 * previous parameters, not these. An edit that changes nothing (`{}` or
 * values equal to the stored ones) is a no-op: the unchanged season is
 * returned with no write, reset or version/pactRevision bump (SS-18).
 */
export async function editSeasonParams(
  deps: EditSeasonParamsDeps,
  actor: Actor,
  input: EditSeasonParamsInput,
): Promise<EditSeasonParamsResult> {
  return deps.uow.transaction(async (repos): Promise<EditSeasonParamsResult> => {
    const season = await repos.seasons.get(input.seasonId);
    if (!season) {
      return err({ kind: "SeasonNotFound" });
    }

    const circle = await repos.circles.get(season.circleId);
    const member = circle ? findActiveMember(circle, actor.userId) : undefined;
    if (!member) {
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

    // No-op (SS-18, PI-S8..S11): every effective value already equals the
    // stored one. Runs after validation (invalid input still errors) and
    // before the window re-check (a no-op never fails the window). The
    // timezone is compared as a raw string, so "utc" vs "UTC" is a change.
    const lengthWeeks = input.lengthWeeks ?? season.lengthWeeks;
    const reviewCadenceWeeks = input.reviewCadenceWeeks ?? season.reviewCadenceWeeks;
    if (
      timeZone === season.timeZone &&
      nominalStart === season.nominalStart &&
      lengthWeeks === season.lengthWeeks &&
      reviewCadenceWeeks === season.reviewCadenceWeeks
    ) {
      return ok({ season, viewerId: member.id });
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
      ...resetApprovals(season),
      timeZone,
      nominalStart,
      lengthWeeks,
      reviewCadenceWeeks,
      version: season.version + 1,
    };
    await repos.seasons.save(updated, season.version);
    return ok({ season: updated, viewerId: member.id });
  });
}
