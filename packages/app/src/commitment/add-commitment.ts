import { findActiveMember } from "../circle/circle.ts";
import { resetApprovals } from "../pact/reset-approvals.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Season, SeasonMutationResult } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { HabitId, SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { buildCommitment, commitmentId } from "./commitment.ts";
import {
  type MeasureInput,
  type ValidateCommitmentError,
  validateCommitment,
} from "./validate-commitment.ts";

export interface AddCommitmentDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly ids: IdGenerator;
}

export interface AddCommitmentInput {
  readonly seasonId: SeasonId;
  readonly habitId: HabitId;
  readonly weightPercent: number;
  readonly privacy: "visible" | "private";
  readonly measure: MeasureInput;
}

export type AddCommitmentResult = Result<SeasonMutationResult, AddCommitmentError>;

export type AddCommitmentError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "PactNotOpen" }
  | ValidateCommitmentError;

/**
 * Adds a commitment to `actor`'s own share of the pact (SS-13) while it's
 * still open (SS-15) -- commitments live inside `Season.commitments`, not
 * their own aggregate/repository (design D6/D12), so this mutates and
 * saves the whole `Season` under its own optimistic `version` (D5), same
 * pattern as `edit-season-params.ts`.
 *
 * Adding a commitment resets all pact approvals (SS-13, PA-2).
 */
export async function addCommitment(
  deps: AddCommitmentDeps,
  actor: Actor,
  input: AddCommitmentInput,
): Promise<AddCommitmentResult> {
  return deps.uow.transaction(async (repos): Promise<AddCommitmentResult> => {
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

    const validated = validateCommitment({
      weightPercent: input.weightPercent,
      measure: input.measure,
    });
    if (!validated.ok) {
      return validated;
    }

    const commitment = buildCommitment({
      id: commitmentId(deps.ids.next()),
      memberId: member.id,
      habitId: input.habitId,
      weightPercent: input.weightPercent,
      privacy: input.privacy,
      measure: validated.value,
    });

    const updated: Season = {
      ...resetApprovals(season),
      commitments: [...season.commitments, commitment],
      version: season.version + 1,
    };
    await repos.seasons.save(updated, season.version);
    return ok({ season: updated, viewerId: member.id });
  });
}
