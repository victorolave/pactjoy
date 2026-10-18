import type { UiKind } from "../shared/ui-error.ts";
import type { EntryValueInput, RecordEntryCommand } from "./pactjoy-api.ts";

/**
 * A record queued on the phone. `localId` is the reference later edits and deletes use
 * (`local:<localId>`) until the server answers with the real `entryId`. `attempted` is persisted
 * before the first request: an attempted record can no longer be rewritten, because its
 * fingerprint may already be on the server (a rewrite would answer `IdempotencyKeyReused`).
 */
export interface QueuedRecord {
  readonly kind: "record";
  readonly localId: string;
  readonly attempted: boolean;
  readonly habitName: string;
  /** Always carries `forDate`: the day the member saw, kept across midnight. */
  readonly command: RecordEntryCommand & { readonly forDate: string };
}

/** A full-state edit (`PUT`). `target` is a server `entryId` or a local reference `local:<id>`. */
export interface QueuedEdit {
  readonly kind: "edit";
  readonly id: string;
  readonly target: string;
  readonly habitName: string;
  readonly forDate: string;
  readonly value: EntryValueInput;
  readonly note: string | null;
}

export interface QueuedDelete {
  readonly kind: "delete";
  readonly id: string;
  readonly target: string;
  readonly habitName: string;
  readonly forDate: string;
}

export type OutboxItem = QueuedRecord | QueuedEdit | QueuedDelete;

/** A rejected item, kept until the member dismisses it (nothing is lost silently). */
export interface OutboxNotice {
  readonly id: string;
  readonly habitName: string;
  readonly forDate: string;
  readonly action: "record" | "edit" | "delete";
  /** The failure kind, or `unconfirmed` when an edit's answer may have been lost. */
  readonly reason: UiKind | "unconfirmed";
}

/** Everything the outbox keeps for one user on this device. */
export interface OutboxState {
  readonly v: 1;
  readonly items: readonly OutboxItem[];
  readonly notices: readonly OutboxNotice[];
}

export const EMPTY_OUTBOX: OutboxState = { v: 1, items: [], notices: [] };

/**
 * The durable, per-user queue of entry writes made without a connection (ADR-0012 addendum). It is
 * keyed by user id so one person's items are never read, or sent, for another. Storage failures
 * never throw: the state then lives in memory for the tab.
 */
export interface OutboxStore {
  /** Empty when nothing is stored or the stored value is corrupt. */
  load(userId: string): OutboxState;
  save(userId: string, state: OutboxState): void;
  /**
   * Forgets every user's state, in storage and in memory (the session ended), and tells this tab's
   * subscribers, so an outbox that is mid-replay stops and does not write its state back.
   */
  clearAll(): void;
  /** Called when another tab changes the stored state, and after `clearAll`. Returns the unsubscribe. */
  subscribe(onChange: () => void): () => void;
}
