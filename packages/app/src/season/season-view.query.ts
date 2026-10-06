import type { MemberId } from "@pactjoy/engine";
import type { Habit } from "../habit/habit.ts";
import type { Repositories } from "../ports/repositories.ts";
import { canSeeDetail } from "../score/privacy.ts";
import { findViewer } from "../score/score-context.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Season } from "./season.ts";

export interface SeasonViewDeps {
  readonly uow: { read<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> };
}

export interface SeasonViewInput {
  readonly seasonId: SeasonId;
}

export type SeasonViewError = { readonly kind: "SeasonNotFound" } | { readonly kind: "NotAMember" };

/**
 * A season together with the member who is asking. The viewer comes from the
 * read itself (the member behind the actor), never from the request, so the
 * caller can project the season for them with `canSeeDetail`.
 */
export interface SeasonView {
  readonly season: Season;
  readonly viewerId: MemberId;
  readonly habits: readonly Habit[];
}

/**
 * The season as one circle member sees it (SV-R1): one `uow.read` resolves the
 * season and the asking member, with the same read-only access rule as the
 * score queries (an active member, or a participant who has since left).
 */
export async function seasonView(
  deps: SeasonViewDeps,
  actor: Actor,
  input: SeasonViewInput,
): Promise<Result<SeasonView, SeasonViewError>> {
  return deps.uow.read(async (repos) => {
    const season = await repos.seasons.get(input.seasonId);
    if (!season) {
      return err({ kind: "SeasonNotFound" });
    }
    const circle = await repos.circles.get(season.circleId);
    const viewer = circle ? findViewer(season, circle, actor) : undefined;
    if (!viewer) return err({ kind: "NotAMember" });
    const visible = season.commitments.filter((c) => canSeeDetail(c, viewer.id));
    const habits = await repos.habits.getMany(visible.map((c) => c.habitId));
    return ok({ season, viewerId: viewer.id, habits });
  });
}
