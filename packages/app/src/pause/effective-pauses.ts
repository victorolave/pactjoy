import { type MemberId, type SeasonDay, seasonDay } from "@pactjoy/engine";
import type { Circle } from "../circle/circle.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { Instant } from "../time/instant.ts";
import { toSeasonDay } from "../time/season-calendar.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { type EffectiveDecision, effectiveDecision } from "./effective-decision.ts";
import type { MemberPauseRequest } from "./pause-request.repository.ts";
import type { PauseRequestRecord } from "./pause-request.ts";
import { toEnginePauses } from "./to-engine.ts";

/** Everything needed to turn persisted requests into what is true at `now`. */
export interface PauseContext {
  readonly season: Season;
  readonly circle: Circle;
  readonly now: Instant;
  readonly timeZone: TimeZone;
}

/** A persisted request together with the decision a reader must act on at `now`. */
export interface EffectivePauseRequest {
  readonly record: PauseRequestRecord;
  readonly decision: EffectiveDecision;
}

/** The season-timezone day an instant falls on; before the season's first day it clamps to day 0. */
export function seasonDayAt(context: PauseContext, at: Instant): SeasonDay {
  const { season, timeZone } = context;
  if (season.actualStart === null) throw new Error(`season ${season.id} has no actual start`);
  const day = toSeasonDay(timeZone.localDateAt(at, season.timeZone), season.actualStart);
  return day.kind === "day" ? day.day : seasonDay(0);
}

/** Active members of the circle other than the requester: the people whose answer is needed. */
export function approversOf(circle: Circle, requester: MemberId): readonly MemberId[] {
  return circle.members.filter((m) => m.status === "active" && m.id !== requester).map((m) => m.id);
}

/**
 * Every request of the season with its effective decision at `context.now`
 * (ADR-0013). Empty while the season has no start day, since no request can
 * exist before it. The ONLY place `pauses.listBySeason` is read outside
 * writes; `choke-point.test.ts` keeps it that way.
 */
export async function loadEffectiveRequests(
  repos: Pick<Repositories, "pauses">,
  context: PauseContext,
): Promise<readonly EffectivePauseRequest[]> {
  if (context.season.actualStart === null) return [];
  const records = await repos.pauses.listBySeason(context.season.id);
  const dayOf = (at: Instant) => seasonDayAt(context, at);
  return records.map((record) => ({
    record,
    decision: effectiveDecision(record, {
      approverIds: approversOf(context.circle, record.memberId),
      now: context.now,
      dayOf,
    }),
  }));
}

/**
 * THE choke point: what the engine must be fed for a season. Every reader of
 * pauses (Today, progress, scores, standings, the Entry window) goes through
 * here, so a pending request that has since been decided never shows stale.
 */
export async function loadEffectivePauses(
  repos: Pick<Repositories, "pauses">,
  context: PauseContext,
): Promise<readonly MemberPauseRequest[]> {
  const requests = await loadEffectiveRequests(repos, context);
  return requests.flatMap(({ record, decision }) => toEnginePauses(record, decision));
}
