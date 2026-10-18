import { ApiError } from "../../../ports/api-error.ts";
import type { IdSource } from "../../../ports/ids.ts";
import type {
  OutboxItem,
  OutboxState,
  OutboxStore,
  SentRecord,
} from "../../../ports/outbox-store.ts";
import type { PactJoyApi } from "../../../ports/pactjoy-api.ts";
import { classify } from "./classify.ts";
import { dismissNotices, rejectWithNotice } from "./notices.ts";
import {
  dependantsOf,
  type EnqueueInput,
  type EnqueueResult,
  enqueue,
  isLocalRef,
  itemId,
  localRef,
  markAttempted,
  rejectItem,
  removeItem,
  resolveRecord,
} from "./queue.ts";

/** A concurrency conflict is retried this many times before the item is rejected. */
const MAX_CONFLICT_RETRIES = 3;
/** The wait before each of those retries: the other writer needs a moment to finish. */
const CONFLICT_RETRY_DELAY_MS = 500;

export interface OutboxDeps {
  /** Only the entry writes: the outbox never reads. */
  readonly api: Pick<PactJoyApi, "recordEntry" | "editEntry" | "deleteEntry">;
  readonly store: OutboxStore;
  /** The signed-in user: the outbox only ever touches this user's state. */
  readonly userId: string;
  readonly ids: IdSource;
  /** Called once after a replay that changed anything, so the server's truth is read again. */
  readonly onReplayed: () => void;
}

/**
 * How a replay ended: `done` (nothing left to send, or only rejections happened), `retry` (a
 * retryable failure stopped it with items still queued) or `session` (the session is gone).
 */
export type DrainStatus = "done" | "retry" | "session";

/**
 * The per-user queue of entry writes made without a connection (OE-R1..R6). It keeps the state in
 * memory, saves every change through the `OutboxStore` before it acts on it, and replays the queue
 * one item at a time in order. The server decides: nothing here computes points or overrides an
 * answer, and a rejected item becomes a notice that stays until the member dismisses it.
 */
export class Outbox {
  readonly #deps: OutboxDeps;
  #state: OutboxState;
  readonly #listeners = new Set<() => void>();
  readonly #enqueueListeners = new Set<() => void>();
  #unsubscribeStore: (() => void) | null = null;
  #running: Promise<DrainStatus> | null = null;
  readonly #conflicts = new Map<string, number>();
  /** `local:<id>` of records sent in this session -> the server's `entryId` (for stale references). */
  readonly #resolved = new Map<string, string>();
  #replaying = false;

  #disposed = false;
  /** Records the server accepted whose entry the fetched Today does not show yet (memory only). */
  #sent: readonly SentRecord[] = [];

  constructor(deps: OutboxDeps) {
    this.#deps = deps;
    this.#state = deps.store.load(deps.userId);
    // For its whole life, subscribers or not: a replay that nobody watches must still hear that
    // the session ended or that another tab queued something (OE-R3.S4, OE-R6).
    this.#followStore();
  }

  /** Stable between changes, so it can back `useSyncExternalStore`. */
  snapshot(): OutboxState {
    return this.#state;
  }

  /** Tells `listener` when the queue, the notices or the replaying flag change. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Stable between changes (it backs `useSyncExternalStore`). */
  sentRecords(): readonly SentRecord[] {
    return this.#sent;
  }

  /** The fetched Today holds these entries now: they no longer need to be laid over it. */
  acknowledge(entryIds: ReadonlySet<string>): void {
    this.#setSent(this.#sent.filter((record) => !entryIds.has(record.entryId)));
  }

  /**
   * Ends this outbox: it stops following the store, stops replaying and never writes again. Its
   * owner (the signed-in user) is gone. Safe to call twice; `activate()` brings it back.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unfollowStore();
    this.#conflicts.clear();
    this.#resolved.clear();
    this.#sent = [];
  }

  /** Undoes `dispose()` (an effect cleanup that React runs and then re-runs, as in StrictMode). */
  activate(): void {
    if (!this.#disposed) return;
    this.#disposed = false;
    this.#followStore();
  }

  /** Whether a replay with items to send is running (the "syncing" banner). Changes tell subscribers. */
  replaying(): boolean {
    return this.#replaying;
  }

  /**
   * The server entry a local reference stands for once its record was sent, else the target as it
   * is. A toast or sheet opened before the sync still holds `local:<id>`: this is how it reaches
   * the real entry. Memory only; it ends with the session.
   */
  resolve(target: string): string {
    return this.#resolved.get(target) ?? target;
  }

  /** Called after every accepted `enqueue` (a trigger for the replay). */
  onEnqueue(listener: () => void): () => void {
    this.#enqueueListeners.add(listener);
    return () => this.#enqueueListeners.delete(listener);
  }

  enqueue(input: EnqueueInput): EnqueueResult {
    const result = enqueue(this.#state, input);
    if (!result.ok) return result;
    this.#commit(result.state);
    for (const listener of [...this.#enqueueListeners]) listener();
    return result;
  }

  dismissNotices(): void {
    this.#commit(dismissNotices(this.#state));
  }

  /** Sends the queue in order. A second call while one runs joins it (one replay at a time). */
  drain(): Promise<DrainStatus> {
    if (this.#running !== null) return this.#running;
    const run = this.#replay().finally(() => {
      this.#running = null;
    });
    this.#running = run;
    return run;
  }

  async #replay(): Promise<DrainStatus> {
    let changed = false;
    let status: DrainStatus = "done";
    try {
      for (;;) {
        if (this.#disposed) {
          status = "session";
          break;
        }
        const item = this.#state.items[0];
        if (item === undefined) break;
        this.#setReplaying(true);
        const id = itemId(item);
        // A record that may reach the server can no longer be rewritten: save that first.
        if (item.kind === "record" && !item.attempted) {
          this.#commit(markAttempted(this.#state, item.localId));
        }
        try {
          const entryId = await this.#send(item);
          if (!this.#disposed) this.#remember(item, entryId);
          this.#commit(
            item.kind === "record" && entryId !== null
              ? resolveRecord(this.#state, item.localId, entryId)
              : removeItem(this.#state, id),
          );
          this.#conflicts.delete(id);
          changed = true;
        } catch (error) {
          const outcome = classify(item, error, {
            dependentDelete:
              item.kind === "record" &&
              dependantsOf(this.#state, item).some((dependant) => dependant.kind === "delete"),
          });
          if (outcome === "retryable") {
            status = "retry";
            break;
          }
          if (outcome === "session") {
            status = "session";
            break;
          }
          if (outcome === "conflict") {
            const retries = (this.#conflicts.get(id) ?? 0) + 1;
            this.#conflicts.set(id, retries);
            if (retries <= MAX_CONFLICT_RETRIES) {
              await new Promise<void>((resolve) => setTimeout(resolve, CONFLICT_RETRY_DELAY_MS));
              continue;
            }
          }
          if (outcome === "sent") {
            if (item.kind === "delete") this.#remember(item, null);
            this.#commit(removeItem(this.#state, id));
          } else if (outcome === "sentAll") this.#commit(rejectItem(this.#state, id).state);
          else this.#reject(id, error);
          this.#conflicts.delete(id);
          changed = true;
        }
      }
    } finally {
      this.#setReplaying(false);
      if (changed) this.#deps.onReplayed();
    }
    return status;
  }

  /**
   * What the server accepted, until the Today fetched afterwards shows it: a sent record's local
   * reference and its row (W2); an edit changes what that row shows, a delete removes it.
   */
  #remember(item: OutboxItem, entryId: string | null): void {
    if (item.kind === "record") {
      if (entryId === null) return;
      this.#resolved.set(localRef(item.localId), entryId);
      const { habitName, command } = item;
      this.#setSent([...this.#sent, { entryId, habitName, command }]);
    } else if (item.kind === "edit") {
      this.#setSent(
        this.#sent.map((record) =>
          record.entryId === item.target
            ? { ...record, command: { ...record.command, value: item.value, note: item.note } }
            : record,
        ),
      );
    } else {
      this.#setSent(this.#sent.filter((record) => record.entryId !== item.target));
    }
  }

  #setSent(next: readonly SentRecord[]): void {
    const same = next.length === this.#sent.length && next.every((r, i) => r === this.#sent[i]);
    if (same) return;
    this.#sent = next;
    this.#notify();
  }

  #setReplaying(value: boolean): void {
    if (this.#replaying === value) return;
    this.#replaying = value;
    this.#notify();
  }

  /** The request for one item; a record answers its `entryId`, the others `null`. */
  async #send(item: OutboxItem): Promise<string | null> {
    const { api } = this.#deps;
    switch (item.kind) {
      case "record":
        return (await api.recordEntry(item.command)).entryId;
      case "edit":
        // The full new state and no `photoId`: the entry keeps its photo.
        await api.editEntry({
          entryId: this.#serverTarget(item.target),
          value: item.value,
          note: item.note,
        });
        return null;
      case "delete":
        await api.deleteEntry(this.#serverTarget(item.target));
        return null;
    }
  }

  /**
   * An edit or delete reaches the head of the queue only after its record was sent (its target was
   * then rewritten) or removed (it went with it). A local reference here means that invariant broke:
   * it is rejected as an entry that no longer exists, never sent to the server.
   */
  #serverTarget(target: string): string {
    if (isLocalRef(target)) throw new ApiError("EntryNotFound", 404, null);
    return target;
  }

  #reject(id: string, error: unknown): void {
    this.#commit(rejectWithNotice(this.#state, id, error, this.#deps.ids.newId()).state);
  }

  #commit(next: OutboxState): void {
    // A disposed outbox belongs to a session that ended: it must not write that session's state back.
    if (this.#disposed || next === this.#state) return;
    this.#deps.store.save(this.#deps.userId, next);
    this.#state = next;
    this.#notify();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  #followStore(): void {
    // The stored state may have moved while it was not followed.
    this.#state = this.#deps.store.load(this.#deps.userId);
    this.#unsubscribeStore = this.#deps.store.subscribe(() => {
      this.#state = this.#deps.store.load(this.#deps.userId);
      this.#notify();
    });
  }

  #unfollowStore(): void {
    this.#unsubscribeStore?.();
    this.#unsubscribeStore = null;
  }
}
