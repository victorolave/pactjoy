import { ApiError } from "../../../ports/api-error.ts";
import type { OutboxItem } from "../../../ports/outbox-store.ts";
import { toUiError } from "../../../shared/ui-error.ts";

/**
 * What the replay does with an answer (OE-R4):
 * - `sent`: done, the item leaves the queue;
 * - `sentAll`: a record the member already deleted: it and the queued delete are both done;
 * - `retryable`: the item stays and the replay stops until the next trigger;
 * - `conflict`: retried a few times, then rejected;
 * - `session`: the session is gone, the replay stops and the session-end rules apply;
 * - `terminal`: the server will never accept it; it leaves the queue as a notice.
 */
export type Outcome = "sent" | "sentAll" | "retryable" | "conflict" | "session" | "terminal";

export interface ClassifyContext {
  /** Whether a delete of this record is queued behind it. */
  readonly dependentDelete: boolean;
}

/**
 * The status speaks first: no answer (0), too many requests (429) or a server error (5xx) never
 * drops an item, whatever code it carries. Otherwise the failure kind decides, so a new API code
 * needs no change here: unknown ones are terminal.
 */
export function classify(item: OutboxItem, error: unknown, context: ClassifyContext): Outcome {
  if (error instanceof ApiError && isTransient(error.status)) return "retryable";
  const { kind, code } = toUiError(error);
  const gone = code === "EntryDeleted" || code === "EntryNotFound";
  // Deleting what is already gone is the goal reached.
  if (item.kind === "delete" && gone) return "sent";
  // The record was replayed after the member deleted it: nothing to create, nothing to delete.
  if (item.kind === "record" && code === "EntryDeleted" && context.dependentDelete) {
    return "sentAll";
  }
  switch (kind) {
    case "sessionExpired":
      return "session";
    case "retryable":
      return "retryable";
    case "conflict":
      return "conflict";
    default:
      return "terminal";
  }
}

const isTransient = (status: number): boolean => status === 0 || status === 429 || status >= 500;
