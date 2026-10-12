import type {
  CommitmentPeriodSummary,
  CommitmentStageView,
  PeriodSummary,
  ReviewDraftView,
  SubmitReviewResult,
} from "@pactjoy/app";

/**
 * Every field is emitted by name (ADR-0011): a field added to an app view is NOT served until it
 * is added here. These views are the OWNER's only (ADR-0014): no member id appears in them.
 */
function presentSummaryCommitment(c: CommitmentPeriodSummary) {
  return {
    commitmentId: c.commitmentId,
    habitName: c.habitName,
    icon: c.icon,
    scheduleKind: c.scheduleKind,
    kept: c.kept,
    counted: c.counted,
    consistencyPercent: c.consistencyPercent,
    idealPercent: c.idealPercent,
    points: c.points,
  };
}

function presentSummary(summary: PeriodSummary) {
  return {
    final: summary.final,
    totals: {
      consistencyPercent: summary.totals.consistencyPercent,
      idealPercent: summary.totals.idealPercent,
      points: summary.totals.points,
    },
    commitments: summary.commitments.map(presentSummaryCommitment),
  };
}

export function presentReviewDraft(view: ReviewDraftView) {
  return {
    status: view.status,
    kind: view.kind,
    srbai: view.srbai,
    weeks: view.weeks === null ? null : { first: view.weeks.first, last: view.weeks.last },
    dueUntil: view.dueUntil,
    summary: view.summary === null ? null : presentSummary(view.summary),
    commitments: view.commitments.map((c) => ({
      commitmentId: c.commitmentId,
      habitName: c.habitName,
      icon: c.icon,
      paused: c.paused,
    })),
  };
}

/** What 35b needs; the stored answers and reflection are never echoed back. */
export function presentSubmittedReview(result: SubmitReviewResult) {
  return {
    status: "completed" as const,
    improvements: result.improvements.map((i) => ({
      commitmentId: i.commitmentId,
      from: i.from,
      to: i.to,
    })),
    nextReviewDate: result.nextReviewDate,
  };
}

export function presentSkippedBaseline() {
  return { status: "skipped" as const };
}

export function presentCommitmentStage(view: CommitmentStageView) {
  return { commitmentId: view.commitmentId, stage: view.stage };
}
