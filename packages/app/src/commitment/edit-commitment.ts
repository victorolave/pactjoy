import type { CommitmentId } from "@pactjoy/engine";
import { findActiveMember } from "../circle/circle.ts";
import { resetApprovals } from "../pact/reset-approvals.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Season } from "../season/season.ts";
import type { Actor } from "../shared/actor.ts";
import type { SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { CommitmentRecord } from "./commitment.ts";
import {
  type MeasureInput,
  type ValidateCommitmentError,
  validateCommitment,
} from "./validate-commitment.ts";

export interface EditCommitmentDeps {
  readonly uow: UnitOfWork<Repositories>;
}

/**
 * `habitId` is deliberately NOT editable here (user decision, 2026-09-30):
 * to re-target a commitment at another habit, remove it and add a new one.
 */
export interface EditCommitmentInput {
  readonly seasonId: SeasonId;
  readonly commitmentId: CommitmentId;
  readonly weightPercent: number;
  readonly privacy: "visible" | "private";
  readonly measure: MeasureInput;
}

export type EditCommitmentError =
  | { readonly kind: "SeasonNotFound" }
  | { readonly kind: "NotAMember" }
  | { readonly kind: "PactNotOpen" }
  | { readonly kind: "CommitmentNotFound" }
  | { readonly kind: "NotOwner" }
  | ValidateCommitmentError;

/**
 * Edits `actor`'s own commitment (SS-13, SS-16) while the pact is still
 * open (SS-15) -- same aggregate-mutation shape as `add-commitment.ts`:
 * `Season.commitments` is replaced in place and saved under the season's
 * own optimistic `version` (D5).
 *
 * Editing a commitment resets all pact approvals (SS-13, PA-2).
 */
export async function editCommitment(
  deps: EditCommitmentDeps,
  actor: Actor,
  input: EditCommitmentInput,
): Promise<Result<Season, EditCommitmentError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Season, EditCommitmentError>> => {
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

    const existing = season.commitments.find((commitment) => commitment.id === input.commitmentId);
    if (!existing) {
      return err({ kind: "CommitmentNotFound" });
    }
    if (existing.memberId !== member.id) {
      return err({ kind: "NotOwner" });
    }

    const validated = validateCommitment({
      weightPercent: input.weightPercent,
      measure: input.measure,
    });
    if (!validated.ok) {
      return validated;
    }

    const updatedCommitment: CommitmentRecord = {
      ...existing,
      weightPercent: input.weightPercent,
      privacy: input.privacy,
      measure: validated.value,
    };

    const updated: Season = {
      ...resetApprovals(season),
      commitments: season.commitments.map((commitment) =>
        commitment.id === input.commitmentId ? updatedCommitment : commitment,
      ),
      version: season.version + 1,
    };
    await repos.seasons.save(updated, season.version);
    return ok(updated);
  });
}
