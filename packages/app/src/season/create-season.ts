import { findActiveMember } from "../circle/circle.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { CircleId } from "../shared/ids.ts";
import { seasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { LocalDate } from "../time/local-date.ts";
import { localDate } from "../time/local-date.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { timeZoneId } from "../time/time-zone.port.ts";
import {
  buildSeason,
  canCreateSeasonFor,
  isReviewCadenceWeeks,
  isSeasonLengthWeeks,
  type ReviewCadenceWeeks,
  reviewCadenceForLength,
  type Season,
  type SeasonLengthWeeks,
  type StartDateWindowError,
  validateStartDateWindow,
} from "./season.ts";

export interface CreateSeasonDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
}

export interface CreateSeasonInput {
  readonly circleId: CircleId;
  /** Raw IANA identifier, validated here via `TimeZone.isValidZone` (SC-6). */
  readonly timezone: string;
  /** Raw "YYYY-MM-DD", validated here via `localDate` (A6). */
  readonly startDate: string;
  readonly lengthWeeks: SeasonLengthWeeks;
  readonly reviewCadenceWeeks?: ReviewCadenceWeeks;
}

export type CreateSeasonError =
  | { readonly kind: "CircleNotFound" }
  | { readonly kind: "CircleArchived" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "InvalidTimezone" }
  | { readonly kind: "InvalidStartDate" }
  | StartDateWindowError
  | { readonly kind: "InvalidLengthWeeks" }
  | { readonly kind: "InvalidReviewCadenceWeeks" }
  | { readonly kind: "SeasonInProgress" };

/**
 * Creates a season directly with its pact open -- there is no `draft`
 * status (B1, new SS-17). `startDate` must be within [today, today+30]
 * (A6, SS-4/SS-5) resolved in the given `timezone` (SC-6), and the circle
 * must not already have a pact-open-or-active season (A5, CM-12 delta).
 * Any active member of the circle may create it -- no admin role (A4),
 * same as `create-circle.ts`/`rename-circle.ts`.
 */
export async function createSeason(
  deps: CreateSeasonDeps,
  actor: Actor,
  input: CreateSeasonInput,
): Promise<Result<Season, CreateSeasonError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Season, CreateSeasonError>> => {
    const circle = await repos.circles.get(input.circleId);
    if (!circle) {
      return err({ kind: "CircleNotFound" });
    }
    if (circle.archivedAt !== null) {
      return err({ kind: "CircleArchived" });
    }
    if (!findActiveMember(circle, actor.userId)) {
      return err({ kind: "NotAMember" });
    }

    if (!isSeasonLengthWeeks(input.lengthWeeks)) {
      return err({ kind: "InvalidLengthWeeks" });
    }
    if (input.reviewCadenceWeeks !== undefined && !isReviewCadenceWeeks(input.reviewCadenceWeeks)) {
      return err({ kind: "InvalidReviewCadenceWeeks" });
    }

    if (!deps.timeZone.isValidZone(input.timezone)) {
      return err({ kind: "InvalidTimezone" });
    }
    const zone = timeZoneId(input.timezone);

    let nominalStart: LocalDate;
    try {
      nominalStart = localDate(input.startDate);
    } catch {
      return err({ kind: "InvalidStartDate" });
    }

    const now = deps.clock.now();
    const today = deps.timeZone.localDateAt(now, zone);
    const windowError = validateStartDateWindow(nominalStart, today);
    if (windowError) {
      return err(windowError);
    }

    const latest = await repos.seasons.findLatestByCircle(circle.id);
    if (!canCreateSeasonFor(latest)) {
      return err({ kind: "SeasonInProgress" });
    }

    const season = buildSeason({
      id: seasonId(deps.ids.next()),
      circleId: circle.id,
      timeZone: zone,
      nominalStart,
      lengthWeeks: input.lengthWeeks,
      reviewCadenceWeeks: input.reviewCadenceWeeks ?? reviewCadenceForLength(input.lengthWeeks),
      now,
    });
    await repos.seasons.save(season, null);
    // CM-12 concurrency guard (BLOCKER-2): a brand-new season always saves
    // with `expectedVersion: null`, so two concurrent createSeason calls on
    // the SAME circle would otherwise both succeed -- each inserts its own
    // fresh id and neither conflicts with the other. There is no per-circle
    // lock, so this "touches" the Circle aggregate itself (bumping its
    // `version`, no field of Circle actually changes) purely to force the
    // two transactions to race on ONE shared optimistic-concurrency check.
    // Reuses Circle's existing `version` -- no redundant state added.
    await repos.circles.save({ ...circle, version: circle.version + 1 }, circle.version);
    return ok(season);
  });
}
