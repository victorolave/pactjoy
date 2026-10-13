import { ApiError } from "../../ports/api-error.ts";
import { longDate } from "../../shared/format.ts";
import { toUiError } from "../../shared/ui-error.ts";
import { failureCopy } from "./copy.ts";

/**
 * What a failed close call means for the screen (ADR-0015, ADR-0011 Q22):
 * - `notYet`: the results day has not come; the message names it.
 * - `closed`: the season is already closed.
 * - `nothing`: the member had no commitments, so there is nothing to decide.
 * - `reviewRequired`: the closing review comes first.
 * - `alreadySubmitted`: nothing to redo; refetch and show the saved decisions. A lost race is the same.
 * - `incomplete`: some habit has no valid decision; back to the habits.
 * - `notFound`: that season is not the member's.
 * - `retry`: the network failed; trying again can help.
 */
export type CloseFailureKind =
  | "notYet"
  | "closed"
  | "nothing"
  | "reviewRequired"
  | "alreadySubmitted"
  | "incomplete"
  | "notFound"
  | "retry"
  | "generic";

export interface CloseFailure {
  readonly kind: CloseFailureKind;
  readonly message: string;
  readonly retryable: boolean;
}

const make = (kind: CloseFailureKind, message: string, retryable = false): CloseFailure => ({
  kind,
  message,
  retryable,
});

const availableOn = (error: ApiError): string | null => {
  const value = error.details?.availableOn;
  return typeof value === "string" ? value : null;
};

function classify(error: unknown, retryMessage: string): CloseFailure {
  if (!(error instanceof ApiError)) return make("generic", failureCopy.generic);
  switch (error.code) {
    case "SeasonResultsNotYet": {
      const day = availableOn(error);
      return make(
        "notYet",
        day === null ? failureCopy.notYetNoDate : failureCopy.notYet(longDate(day, false)),
      );
    }
    case "SeasonNotActive":
      return make("closed", failureCopy.closed);
    case "NothingToClose":
      return make("nothing", failureCopy.nothing);
    case "ClosingReviewRequired":
      return make("reviewRequired", failureCopy.reviewRequired);
    case "ClosureAlreadySubmitted":
    case "ConcurrencyConflict":
      return make("alreadySubmitted", failureCopy.alreadySubmitted);
    case "ClosureIncomplete":
    case "InvalidClosureDecision":
      return make("incomplete", failureCopy.incomplete);
    case "SeasonNotFound":
    case "NotAMember":
      return make("notFound", failureCopy.notFound);
    default:
      return toUiError(error).retryable
        ? make("retry", retryMessage, true)
        : make("generic", failureCopy.generic);
  }
}

/** A failed `POST /seasons/:id/closure`. */
export const closeFailure = (error: unknown): CloseFailure =>
  classify(error, failureCopy.saveRetry);

/** A failed `GET /seasons/:id/results`. */
export const loadFailure = (error: unknown): CloseFailure => classify(error, failureCopy.loadRetry);
