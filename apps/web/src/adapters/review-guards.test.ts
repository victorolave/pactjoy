import { describe, expect, it } from "vitest";
import {
  baselineFixture,
  interimFullFixture,
  skippedFixture,
  stageFixture,
  submittedFixture,
} from "../testing/fixtures/review.ts";
import {
  isCommitmentStage,
  isReviewDraft,
  isSkippedBaseline,
  isSubmittedReview,
} from "./review-guards.ts";

describe("isReviewDraft", () => {
  it("accepts an interim review with a summary and a baseline without one", () => {
    expect(isReviewDraft(interimFullFixture())).toBe(true);
    expect(isReviewDraft(baselineFixture())).toBe(true);
  });

  it("accepts a closing review that never lapses (dueUntil null)", () => {
    expect(isReviewDraft(interimFullFixture({ kind: "closing", dueUntil: null }))).toBe(true);
  });

  it("rejects an unknown kind, status or srbai mode", () => {
    expect(isReviewDraft({ ...interimFullFixture(), kind: "weekly" })).toBe(false);
    expect(isReviewDraft({ ...interimFullFixture(), status: "later" })).toBe(false);
    expect(isReviewDraft({ ...interimFullFixture(), srbai: "half" })).toBe(false);
  });

  it("rejects a commitment without a paused flag or a summary row without kept and counted", () => {
    const draft = interimFullFixture();
    expect(
      isReviewDraft({
        ...draft,
        commitments: [{ commitmentId: "c", habitName: "Leer", icon: null }],
      }),
    ).toBe(false);
    expect(
      isReviewDraft({
        ...draft,
        summary: { ...draft.summary, commitments: [{ commitmentId: "c", habitName: "Leer" }] },
      }),
    ).toBe(false);
  });

  it("rejects a date that is not YYYY-MM-DD and non-objects", () => {
    expect(isReviewDraft({ ...interimFullFixture(), dueUntil: "6 de octubre" })).toBe(false);
    expect(isReviewDraft(null)).toBe(false);
    expect(isReviewDraft([])).toBe(false);
  });
});

describe("isSubmittedReview", () => {
  it("accepts improvements and a next date, or no next date after the closing review", () => {
    expect(
      isSubmittedReview(
        submittedFixture({ improvements: [{ commitmentId: "c", from: "3,5", to: "4,5" }] }),
      ),
    ).toBe(true);
    expect(isSubmittedReview(submittedFixture({ nextReviewDate: null }))).toBe(true);
  });

  it("rejects a wrong status, a missing improvements list or an improvement without from and to", () => {
    expect(isSubmittedReview({ ...submittedFixture(), status: "skipped" })).toBe(false);
    expect(isSubmittedReview({ status: "completed", nextReviewDate: null })).toBe(false);
    expect(
      isSubmittedReview(submittedFixture({ improvements: [{ commitmentId: "c" } as never] })),
    ).toBe(false);
  });
});

describe("isSkippedBaseline and isCommitmentStage", () => {
  it("accept their shapes and reject anything else", () => {
    expect(isSkippedBaseline(skippedFixture())).toBe(true);
    expect(isSkippedBaseline({ status: "completed" })).toBe(false);
    expect(isCommitmentStage(stageFixture("c", "developing"))).toBe(true);
    expect(isCommitmentStage({ commitmentId: "c", stage: "sprout" })).toBe(false);
    expect(isCommitmentStage({ stage: "new" })).toBe(false);
  });
});
