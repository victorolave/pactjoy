import type { Circle, Member } from "../circle/circle.ts";
import { activeViewerOf } from "../feed/feed-context.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";

export type NudgeActorError = { readonly kind: "SeasonNotFound" } | { readonly kind: "NotAMember" };

/** Who is acting on a season's nudge: the season, its circle and the actor as an ACTIVE member of it. */
export interface NudgeActor {
  readonly season: Season;
  readonly circle: Circle;
  readonly viewer: Member;
}

/**
 * Resolves the season and the actor for a send or a dismissal: the season must exist
 * (`SeasonNotFound`) and the actor must be an ACTIVE member of its circle (`NotAMember`; someone
 * who left cannot encourage or dismiss).
 */
export async function loadNudgeActor(
  repos: Pick<Repositories, "seasons" | "circles">,
  actor: Actor,
  seasonId: SeasonId,
): Promise<Result<NudgeActor, NudgeActorError>> {
  const season = await repos.seasons.get(seasonId);
  if (!season) return err({ kind: "SeasonNotFound" });
  const circle = await repos.circles.get(season.circleId);
  const viewer = circle ? activeViewerOf(circle, actor) : undefined;
  if (!circle || !viewer) return err({ kind: "NotAMember" });
  return ok({ season, circle, viewer });
}
