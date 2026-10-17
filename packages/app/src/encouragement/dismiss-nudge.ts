import type { MemberId } from "@pactjoy/engine";
import { type FeedDeps, feedContextOf, loadFeedWorld } from "../feed/feed-context.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { loadNudgeActor, type NudgeActorError } from "./nudge-actor.ts";
import { loadNudgeCase } from "./nudge-for-viewer.ts";

export interface DismissNudgeDeps extends FeedDeps {
  readonly uow: UnitOfWork<Repositories>;
}

export interface DismissNudgeInput {
  readonly seasonId: SeasonId;
  readonly targetId: MemberId;
  /** The target's hard week, 1-based, as the suggestion named it. */
  readonly week: number;
}

export type DismissNudgeError = NudgeActorError | { readonly kind: "NudgeNotAvailable" };

/**
 * "Ahora no" (ADR-0018, F15; REQ-N4): hides the case `(viewer, target, week)` for good, with no
 * reason asked. IDEMPOTENT: a case the viewer already dismissed succeeds and changes nothing, even
 * on a later day. Otherwise the case must be the viewer's live suggestion right now
 * (`NudgeNotAvailable`), so a made-up case cannot be stored. The dismissal also counts as the
 * day's one action (the strict daily rule), which `pickNudge` reads back.
 */
export async function dismissNudge(
  deps: DismissNudgeDeps,
  actor: Actor,
  input: DismissNudgeInput,
): Promise<Result<void, DismissNudgeError>> {
  return deps.uow.transaction(async (repos): Promise<Result<void, DismissNudgeError>> => {
    const resolved = await loadNudgeActor(repos, actor, input.seasonId);
    if (!resolved.ok) return resolved;
    const { season, circle, viewer } = resolved.value;

    const mine = await repos.nudgeDismissals.listMine(season.id, viewer.id);
    if (mine.some((d) => d.targetId === input.targetId && d.caseWeek === input.week)) {
      return ok(undefined);
    }

    const now = deps.clock.now();
    const context = await feedContextOf(deps, repos, circle, now);
    if (!context || context.season.id !== season.id) return err({ kind: "NudgeNotAvailable" });
    const world = await loadFeedWorld(deps, repos, context);
    const live = await loadNudgeCase(repos, context, world, viewer);
    if (live === null || live.targetId !== input.targetId || live.week !== input.week) {
      return err({ kind: "NudgeNotAvailable" });
    }

    await repos.nudgeDismissals.add({
      seasonId: season.id,
      viewerId: viewer.id,
      targetId: input.targetId,
      caseWeek: input.week,
      dismissedAt: now,
      dismissedOn: context.todayDate,
    });
    return ok(undefined);
  });
}
