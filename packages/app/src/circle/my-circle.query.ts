import type { MemberId } from "@pactjoy/engine";
import type { ScoreQueryDeps } from "../score/score-context.ts";
import type { SeasonLengthWeeks } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { CircleId, SeasonId } from "../shared/ids.ts";
import type { Instant } from "../time/instant.ts";
import { type SeasonPhaseName, seasonPhase, weekOf } from "../today/season-phase.ts";
import type { InviteCode } from "./invite-code.ts";

export type MyCircleDeps = ScoreQueryDeps;

export interface MyCircleMember {
  readonly id: MemberId;
  readonly displayName: string;
  readonly joinedAt: Instant;
  readonly isYou: boolean;
}

export interface MyCircleSeason {
  readonly id: SeasonId;
  readonly phase: SeasonPhaseName;
  readonly lengthWeeks: SeasonLengthWeeks;
  /** 1-based; `null` until the season has started. */
  readonly week: number | null;
  readonly approvalCount: number;
}

/** The viewer's active circle for the Circle tab; `userId` never appears in it. */
export interface MyCircleView {
  readonly circle: null | {
    readonly id: CircleId;
    readonly name: string;
    /** Active members only, in repository order. */
    readonly members: readonly MyCircleMember[];
    /** Always returned when present (the viewer is active); the client compares `expiresAt`. */
    readonly invite: null | {
      readonly code: InviteCode;
      readonly createdAt: Instant;
      readonly expiresAt: Instant;
    };
  };
  /** `null` without a season or when the latest one is closed. */
  readonly season: MyCircleSeason | null;
}

/**
 * The asking user's active circle and its latest season, in ONE read. Total: no app error. A
 * `closed` latest season is treated as no season (same rule as Today).
 */
export async function myCircle(deps: MyCircleDeps, actor: Actor): Promise<MyCircleView> {
  return deps.uow.read(async (repos): Promise<MyCircleView> => {
    // No archived check: the last active member leaving archives the circle, so an archived
    // circle never has an active member and cannot be found here.
    const circle = await repos.circles.findActiveByUser(actor.userId);
    if (!circle) {
      return { circle: null, season: null };
    }
    const view: NonNullable<MyCircleView["circle"]> = {
      id: circle.id,
      name: circle.name,
      members: circle.members
        .filter((member) => member.status === "active")
        .map((member) => ({
          id: member.id,
          displayName: member.displayName,
          joinedAt: member.joinedAt,
          isYou: member.userId === actor.userId,
        })),
      invite: circle.invite && {
        code: circle.invite.code,
        createdAt: circle.invite.createdAt,
        expiresAt: circle.invite.expiresAt,
      },
    };
    const season = await repos.seasons.findLatestByCircle(circle.id);
    if (!season || season.status === "closed") {
      return { circle: view, season: null };
    }
    const today = deps.timeZone.localDateAt(deps.clock.now(), season.timeZone);
    const phase = seasonPhase(season, today);
    return {
      circle: view,
      season: {
        id: season.id,
        phase: phase.phase,
        lengthWeeks: season.lengthWeeks,
        week: "scoringDay" in phase ? weekOf(phase.scoringDay) : null,
        approvalCount: season.approvals.length,
      },
    };
  });
}
