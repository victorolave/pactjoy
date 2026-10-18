import type {
  OutboxItem,
  OutboxState,
  QueuedDelete,
  QueuedEdit,
  QueuedRecord,
} from "../../../ports/outbox-store.ts";
import type { RecordEntryCommand } from "../../../ports/pactjoy-api.ts";

/**
 * The queue model: pure functions over the persisted state (ADR-0012 addendum). It decides what an
 * enqueued command turns into (coalescing) and never does I/O, so the replay engine can persist the
 * result and the tests can table-drive it.
 *
 * A record is addressed by a local reference (`local:<localId>`) until the server answers with the
 * real `entryId`. A never-attempted record exists only on this phone, so edits and deletes of it
 * rewrite or remove it in place. An ATTEMPTED record may already be on the server: rewriting it
 * would change its fingerprint and the replay would answer `IdempotencyKeyReused`, so edits and
 * deletes of it become dependants that wait for its answer.
 */

const LOCAL_PREFIX = "local:";

export const localRef = (localId: string): string => `${LOCAL_PREFIX}${localId}`;
export const isLocalRef = (target: string): boolean => target.startsWith(LOCAL_PREFIX);

/** The id an item is removed by: a record's `localId`, or an edit's or delete's own `id`. */
export const itemId = (item: OutboxItem): string =>
  item.kind === "record" ? item.localId : item.id;

export type EnqueueInput =
  | {
      readonly kind: "record";
      readonly localId: string;
      readonly habitName: string;
      readonly command: RecordEntryCommand;
    }
  | QueuedEdit
  | QueuedDelete;

/**
 * Why a command is not queued: it carries a photo (needs a server-signed slot), it has no day, or it
 * aims at a local reference that is no longer in the queue (the record was already sent).
 */
export type EnqueueRefusal = "photo" | "noDay" | "unknownLocal";

export type EnqueueResult =
  | { readonly ok: true; readonly state: OutboxState }
  | { readonly ok: false; readonly reason: EnqueueRefusal };

const withItems = (state: OutboxState, items: readonly OutboxItem[]): OutboxState => ({
  ...state,
  items,
});

const targetOf = (item: OutboxItem): string | null => (item.kind === "record" ? null : item.target);

const findRecord = (state: OutboxState, ref: string): QueuedRecord | undefined =>
  state.items.find(
    (item): item is QueuedRecord => item.kind === "record" && localRef(item.localId) === ref,
  );

/** The edits and deletes waiting for `record` to be sent. */
export function dependantsOf(state: OutboxState, record: QueuedRecord): OutboxItem[] {
  const ref = localRef(record.localId);
  return state.items.filter((item) => targetOf(item) === ref);
}

const isEditOf = (target: string) => (item: OutboxItem) =>
  item.kind === "edit" && item.target === target;

export function enqueue(state: OutboxState, input: EnqueueInput): EnqueueResult {
  switch (input.kind) {
    case "record":
      return enqueueRecord(state, input);
    case "edit":
      return enqueueEdit(state, input);
    case "delete":
      return enqueueDelete(state, input);
  }
}

function enqueueRecord(
  state: OutboxState,
  input: Extract<EnqueueInput, { kind: "record" }>,
): EnqueueResult {
  const { command } = input;
  if (command.photoId !== undefined && command.photoId !== null) {
    return { ok: false, reason: "photo" };
  }
  if (command.forDate === undefined) return { ok: false, reason: "noDay" };
  const record: QueuedRecord = {
    kind: "record",
    localId: input.localId,
    attempted: false,
    habitName: input.habitName,
    command: { ...command, forDate: command.forDate },
  };
  return { ok: true, state: withItems(state, [...state.items, record]) };
}

function enqueueEdit(state: OutboxState, edit: QueuedEdit): EnqueueResult {
  if (isLocalRef(edit.target)) {
    const record = findRecord(state, edit.target);
    if (record === undefined) return { ok: false, reason: "unknownLocal" };
    if (!record.attempted) {
      // Only on this phone: change the record itself, keeping its idempotency key.
      const rewritten: QueuedRecord = {
        ...record,
        command: { ...record.command, value: edit.value, note: edit.note },
      };
      return {
        ok: true,
        state: withItems(
          state,
          state.items.map((item) => (item === record ? rewritten : item)),
        ),
      };
    }
  }
  // The latest edit of a target replaces the earlier one where it stood.
  const earlier = state.items.findIndex(isEditOf(edit.target));
  if (earlier === -1) return { ok: true, state: withItems(state, [...state.items, edit]) };
  const items = state.items.filter((_item, index) => index !== earlier);
  items.splice(earlier, 0, edit);
  return { ok: true, state: withItems(state, items) };
}

function enqueueDelete(state: OutboxState, remove: QueuedDelete): EnqueueResult {
  if (isLocalRef(remove.target)) {
    const record = findRecord(state, remove.target);
    if (record === undefined) return { ok: false, reason: "unknownLocal" };
    // Never sent: nothing to tell the server, so it is as if the member never recorded it.
    if (!record.attempted) {
      return {
        ok: true,
        state: withItems(
          state,
          state.items.filter((item) => item !== record),
        ),
      };
    }
  }
  const alreadyQueued = state.items.some(
    (item) => item.kind === "delete" && item.target === remove.target,
  );
  const kept = state.items.filter((item) => !isEditOf(remove.target)(item));
  return { ok: true, state: withItems(state, alreadyQueued ? kept : [...kept, remove]) };
}

/** Persist this before the request: a record that may have reached the server is no longer rewritable. */
export function markAttempted(state: OutboxState, localId: string): OutboxState {
  return withItems(
    state,
    state.items.map((item) =>
      item.kind === "record" && item.localId === localId ? { ...item, attempted: true } : item,
    ),
  );
}

/** The record was sent: drop it and aim its dependants at the server's `entryId`. */
export function resolveRecord(state: OutboxState, localId: string, entryId: string): OutboxState {
  const ref = localRef(localId);
  const items: OutboxItem[] = [];
  for (const item of state.items) {
    if (item.kind === "record" && item.localId === localId) continue;
    items.push(item.kind !== "record" && item.target === ref ? { ...item, target: entryId } : item);
  }
  return withItems(state, items);
}

export function removeItem(state: OutboxState, id: string): OutboxState {
  return withItems(
    state,
    state.items.filter((item) => itemId(item) !== id),
  );
}

/** Takes out a rejected item and, for a record, the items waiting for it; returns what went. */
export function rejectItem(
  state: OutboxState,
  id: string,
): { readonly state: OutboxState; readonly removed: readonly OutboxItem[] } {
  const root = state.items.find((item) => itemId(item) === id);
  if (root === undefined) return { state, removed: [] };
  const removed = [root, ...(root.kind === "record" ? dependantsOf(state, root) : [])];
  return {
    state: withItems(
      state,
      state.items.filter((item) => !removed.includes(item)),
    ),
    removed,
  };
}
