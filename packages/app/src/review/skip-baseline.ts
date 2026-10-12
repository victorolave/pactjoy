import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { reviewId, type SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { ReviewRecord } from "./review.ts";
import {
  loadReviewContext,
  type ReviewClockDeps,
  type ReviewContextError,
  refusalOf,
} from "./review-context.ts";

export interface SkipBaselineDeps extends ReviewClockDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly ids: IdGenerator;
}

export interface SkipBaselineInput {
  readonly seasonId: SeasonId;
  /** Validated here: anything but 0 (the baseline) cannot be skipped. */
  readonly periodIndex: number;
}

export type SkipBaselineError =
  | ReviewContextError
  | { readonly kind: "ReviewNotSkippable" }
  | { readonly kind: "ReviewNotDue"; readonly reason: "notYet" | "lapsed" }
  | { readonly kind: "ReviewAlreadySubmitted" };

/**
 * "Ahora no" on the baseline (REQ-B2): stores a skipped baseline so the offer stops being shown.
 * It carries no answers and no reflection, and it never touches points or Entries (REQ-B7). Only
 * the baseline is optional: any other period is `ReviewNotSkippable` (a periodic review is
 * answered or it lapses). Skipping twice, or after answering, is `ReviewAlreadySubmitted` and
 * stores nothing; after day 7 the offer already lapsed (`ReviewNotDue`).
 */
export async function skipBaseline(
  deps: SkipBaselineDeps,
  actor: Actor,
  input: SkipBaselineInput,
): Promise<Result<ReviewRecord, SkipBaselineError>> {
  return deps.uow.transaction(async (repos): Promise<Result<ReviewRecord, SkipBaselineError>> => {
    const context = await loadReviewContext(deps, repos, actor, input.seasonId, input.periodIndex);
    if (!context.ok) return context;
    const { season, member, slot, now } = context.value;
    if (slot.kind !== "baseline") return err({ kind: "ReviewNotSkippable" });
    const refusal = refusalOf(slot);
    if (refusal !== null) return err(refusal);

    const review: ReviewRecord = {
      id: reviewId(deps.ids.next()),
      seasonId: season.id,
      memberId: member.id,
      periodIndex: slot.index,
      kind: "baseline",
      status: "skipped",
      srbai: null,
      reflection: { helped: null, hard: null },
      responses: [],
      recordedAt: now,
      version: 0,
    };
    await repos.reviews.save(review, null);
    return ok(review);
  });
}
