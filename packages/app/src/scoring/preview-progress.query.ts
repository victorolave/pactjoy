import { displayPercent, parseDecimal, progressAtValue } from "@pactjoy/engine";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import { commitmentToEngine } from "../commitment/to-engine.ts";
import {
  type MeasureInput,
  type ValidateCommitmentError,
  validateCommitment,
} from "../commitment/validate-commitment.ts";
import type { Actor } from "../shared/actor.ts";
import { habitId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";

export interface PreviewProgressInput {
  readonly measure: MeasureInput;
  readonly values: readonly string[];
}
export type PreviewProgressError =
  | ValidateCommitmentError
  | { readonly kind: "InvalidPreviewValues" };
export interface PreviewProgressView {
  readonly rows: readonly { readonly value: string; readonly progressPercent: string }[];
}

/** Pure draft preview: no repositories, clock, persistence or client-side scoring. */
export function previewProgress(
  _actor: Actor,
  input: PreviewProgressInput,
): Result<PreviewProgressView, PreviewProgressError> {
  const validated = validateCommitment({ weightPercent: 100, measure: input.measure });
  if (!validated.ok) return validated;
  // Same bounded decimal precision as quantities; samples may be fractional even for whole units.
  if (
    input.values.length < 1 ||
    input.values.length > 8 ||
    input.values.some((v) => !/^\d{1,9}(\.\d{1,2})?$/.test(v))
  ) {
    return err({ kind: "InvalidPreviewValues" });
  }
  const commitment = commitmentToEngine({
    id: commitmentId("preview"),
    memberId: memberId("preview"),
    habitId: habitId("preview"),
    privacy: "private",
    weightPercent: 100,
    measure: validated.value,
  });
  return ok({
    rows: input.values.map((value) => ({
      value,
      progressPercent: String(displayPercent(progressAtValue(commitment, parseDecimal(value)))),
    })),
  });
}
