import type { CommitmentId } from "@pactjoy/engine";
import { exceedsNoteLimit, isStorableNote, normalizeNote } from "../entry/entry.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { reviewId, type SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { LocalDate } from "../time/local-date.ts";
import { improvementsOf, type ReviewImprovement } from "./improvements.ts";
import type {
  AutomaticityResponse,
  ReviewRecord,
  ReviewReflection,
  SrbaiItems,
  SrbaiMode,
  SrbaiScore,
} from "./review.ts";
import {
  loadReviewContext,
  type ReviewClockDeps,
  type ReviewContextError,
  refusalOf,
} from "./review-context.ts";
import { nextReviewDate } from "./review-schedule.ts";

export interface SubmitReviewDeps extends ReviewClockDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly ids: IdGenerator;
}

/** What the member answered about one of their commitments; validated here at runtime. */
export interface SubmittedAnswer {
  readonly commitmentId: CommitmentId;
  /** Four slots: item 1 always, items 2-4 only in a full review (`null` when not asked). */
  readonly items: readonly (number | null)[];
}

export interface SubmitReviewInput {
  readonly seasonId: SeasonId;
  /** 0 is the baseline. Validated here: it may arrive from an arbitrary URL. */
  readonly periodIndex: number;
  readonly reflection: { readonly helped: string | null; readonly hard: string | null };
  readonly automaticity: readonly SubmittedAnswer[];
}

export interface SubmitReviewResult {
  readonly review: ReviewRecord;
  /** The commitments that feel more automatic than before, and only those (35b). */
  readonly improvements: readonly ReviewImprovement[];
  /** When the next review becomes due; `null` after the closing review. */
  readonly nextReviewDate: LocalDate | null;
}

export type SubmitReviewError =
  | ReviewContextError
  | { readonly kind: "ReviewNotDue"; readonly reason: "notYet" | "lapsed" }
  | { readonly kind: "ReviewAlreadySubmitted" }
  | { readonly kind: "CommitmentNotOwned" }
  | { readonly kind: "InvalidAutomaticity"; readonly commitmentId: CommitmentId }
  | { readonly kind: "AutomaticityIncomplete"; readonly commitmentIds: readonly CommitmentId[] }
  | { readonly kind: "InvalidNote"; readonly field: "helped" | "hard" }
  | { readonly kind: "NoteTooLong"; readonly field: "helped" | "hard" };

const SRBAI_MIN = 1;
const SRBAI_MAX = 7;
const ITEM_COUNT = 4;

function isScore(value: unknown): value is SrbaiScore {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= SRBAI_MIN && value <= SRBAI_MAX
  );
}

/** The four slots as items, or `null` when the shape or a value is wrong (item 1 must be a score). */
function readItems(raw: readonly unknown[]): SrbaiItems | null {
  if (raw.length !== ITEM_COUNT) return null;
  const [first, ...rest] = raw;
  if (!isScore(first)) return null;
  const others: (SrbaiScore | null)[] = [];
  for (const item of rest) {
    if (item === null) others.push(null);
    else if (isScore(item)) others.push(item);
    else return null;
  }
  const [second = null, third = null, fourth = null] = others;
  return [first, second, third, fourth];
}

function readReflection(
  input: SubmitReviewInput["reflection"],
): Result<ReviewReflection, SubmitReviewError> {
  const read = (field: "helped" | "hard", raw: string | null) => {
    const text = normalizeNote(raw === null ? null : raw.trim());
    if (!isStorableNote(text)) return err({ kind: "InvalidNote" as const, field });
    if (exceedsNoteLimit(text)) return err({ kind: "NoteTooLong" as const, field });
    return ok(text);
  };
  const helped = read("helped", input.helped);
  if (!helped.ok) return helped;
  const hard = read("hard", input.hard);
  if (!hard.ok) return hard;
  return ok({ helped: helped.value, hard: hard.value });
}

/**
 * Saves the member's answers for the review that is due (REQ-S1..S8, REQ-A6). One transaction: it
 * checks the member, the window AT THE CLOCK, the reflection and the answers, and only then
 * inserts the review; a rejection stores nothing. Nothing computed is stored (REQ-S6): the period
 * summary is recomputed from Entries whenever it is read.
 *
 * A review is final: a second submission for the period is `ReviewAlreadySubmitted`, and two
 * racing submits end at the unique key as a `ConcurrencyConflict` (the web then refetches). The
 * baseline has no reflection step, so any reflection sent with it is dropped. A paused commitment
 * is asked about like any other (REQ-P1). Answers for a FULL review need all four items for every
 * commitment (owner decision): a missing one is `AutomaticityIncomplete`; a wrong one
 * (out of 1..7, non-integer, unexpected item, repeated commitment) is `InvalidAutomaticity` and
 * takes precedence.
 */
export async function submitReview(
  deps: SubmitReviewDeps,
  actor: Actor,
  input: SubmitReviewInput,
): Promise<Result<SubmitReviewResult, SubmitReviewError>> {
  return deps.uow.transaction(
    async (repos): Promise<Result<SubmitReviewResult, SubmitReviewError>> => {
      const context = await loadReviewContext(
        deps,
        repos,
        actor,
        input.seasonId,
        input.periodIndex,
      );
      if (!context.ok) return context;
      const { season, mine, member, slot, now, actualStart } = context.value;

      const refusal = refusalOf(slot);
      if (refusal !== null) return err(refusal);

      // The baseline has no reflection step: whatever came with it is dropped, not validated.
      const reflection =
        slot.kind === "baseline"
          ? ok({ helped: null, hard: null })
          : readReflection(input.reflection);
      if (!reflection.ok) return reflection;

      const mode: SrbaiMode = slot.srbai;
      const owned = new Set(mine.map((commitment) => commitment.id));
      const answers = new Map<CommitmentId, SrbaiItems>();
      for (const answer of input.automaticity) {
        if (!owned.has(answer.commitmentId)) return err({ kind: "CommitmentNotOwned" });
        const items = answers.has(answer.commitmentId) ? null : readItems(answer.items);
        const unexpected =
          mode === "item1" && items !== null && items.slice(1).some((i) => i !== null);
        if (items === null || unexpected) {
          return err({ kind: "InvalidAutomaticity", commitmentId: answer.commitmentId });
        }
        answers.set(answer.commitmentId, items);
      }
      const incomplete = mine.filter((commitment) => {
        const items = answers.get(commitment.id);
        return items === undefined || (mode === "full" && items.some((item) => item === null));
      });
      if (incomplete.length > 0) {
        return err({
          kind: "AutomaticityIncomplete",
          commitmentIds: incomplete.map((commitment) => commitment.id),
        });
      }

      const responses = mine.map((commitment): AutomaticityResponse => {
        const items = answers.get(commitment.id);
        if (items === undefined) throw new Error(`answer for ${commitment.id} vanished`);
        return { commitmentId: commitment.id, items };
      });
      const review: ReviewRecord = {
        id: reviewId(deps.ids.next()),
        seasonId: season.id,
        memberId: member.id,
        periodIndex: slot.index,
        kind: slot.kind,
        status: "completed",
        srbai: mode,
        reflection: reflection.value,
        responses,
        recordedAt: now,
        version: 0,
      };
      await repos.reviews.save(review, null);

      return ok({
        review,
        improvements: improvementsOf(responses, context.value.stored),
        nextReviewDate: nextReviewDate(
          season.lengthWeeks,
          season.reviewCadenceWeeks,
          slot.index,
          actualStart,
        ),
      });
    },
  );
}
