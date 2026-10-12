import type { PauseRequest } from "@pactjoy/engine";

/**
 * The history the pause CAP is measured against. The engine counts a
 * pending request only through today, which is right for scoring ("en
 * espera" holds the days that have arrived). The cap is about what has been
 * PLANNED: a pending request with a fixed end claims its whole span from the
 * moment it is made, otherwise two non-overlapping future requests could
 * together exceed the 50% (R4b, "a fixed end cannot exceed what remains").
 *
 * So, for the budget only, a pending fixed-end request is read as if it were
 * approved over its whole span. An open one keeps counting through today.
 * Approved requests already count their full fixed span and honor an early
 * resume; rejected (and cancelled) ones count nothing. The result is for
 * `pauseBudget`/`canRequestPause` only, never for scoring.
 */
export function plannedBudgetHistory(history: readonly PauseRequest[]): readonly PauseRequest[] {
  return history.map((pause) =>
    pause.decision.kind === "pending" && pause.end.kind === "fixed"
      ? { ...pause, decision: { kind: "approved", decidedOn: pause.startDay, resumedOn: null } }
      : pause,
  );
}
