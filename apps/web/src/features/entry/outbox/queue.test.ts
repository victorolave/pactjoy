import { describe, expect, it } from "vitest";
import {
  EMPTY_OUTBOX,
  type OutboxItem,
  type OutboxState,
  type QueuedRecord,
} from "../../../ports/outbox-store.ts";
import type { RecordEntryCommand } from "../../../ports/pactjoy-api.ts";
import {
  dependantsOf,
  type EnqueueInput,
  enqueue,
  isLocalRef,
  itemId,
  localRef,
  markAttempted,
  rejectItem,
  removeItem,
  resolveRecord,
} from "./queue.ts";

const recordCommand = (overrides: Partial<RecordEntryCommand> = {}): RecordEntryCommand => ({
  seasonId: "s1",
  commitmentId: "c1",
  forDate: "2026-10-13",
  value: { kind: "done" },
  note: null,
  clientRequestId: "req-1",
  ...overrides,
});

const recordInput = (
  localId: string,
  overrides: Partial<RecordEntryCommand> = {},
): EnqueueInput => ({
  kind: "record",
  localId,
  habitName: "Dibujar",
  command: recordCommand({ clientRequestId: `req-${localId}`, ...overrides }),
});

const editInput = (id: string, target: string, minutes = "30", note: string | null = null) =>
  ({
    kind: "edit",
    id,
    target,
    habitName: "Dibujar",
    forDate: "2026-10-13",
    value: { kind: "quantity", value: minutes },
    note,
  }) satisfies EnqueueInput;

const deleteInput = (id: string, target: string) =>
  ({
    kind: "delete",
    id,
    target,
    habitName: "Dibujar",
    forDate: "2026-10-13",
  }) satisfies EnqueueInput;

/** Applies each input in order from `start` and fails the test if one is refused. */
function applyAll(start: OutboxState, ...inputs: readonly EnqueueInput[]): OutboxState {
  return inputs.reduce<OutboxState>((state, input) => {
    const result = enqueue(state, input);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result.state;
  }, start);
}

const queueOf = (...inputs: readonly EnqueueInput[]) => applyAll(EMPTY_OUTBOX, ...inputs);

const ids = (state: OutboxState) => state.items.map(itemId);
const recordOf = (state: OutboxState, localId: string) =>
  state.items.find(
    (item): item is QueuedRecord => item.kind === "record" && item.localId === localId,
  );

describe("enqueue", () => {
  it("stores a record with its forDate and clientRequestId, not attempted (OE-R1.S1)", () => {
    const state = queueOf(recordInput("a"));
    expect(state.items).toEqual([
      {
        kind: "record",
        localId: "a",
        attempted: false,
        habitName: "Dibujar",
        command: recordCommand({ clientRequestId: "req-a" }),
      },
    ]);
  });

  it("refuses a record that carries a photo (OE-R1.S4)", () => {
    const result = enqueue(EMPTY_OUTBOX, recordInput("a", { photoId: "photo-1" }));
    expect(result).toEqual({ ok: false, reason: "photo" });
  });

  it("accepts a record whose photoId is null or omitted", () => {
    expect(enqueue(EMPTY_OUTBOX, recordInput("a", { photoId: null })).ok).toBe(true);
    expect(enqueue(EMPTY_OUTBOX, recordInput("b")).ok).toBe(true);
  });

  it("refuses a record with no forDate (OE-R1.S5)", () => {
    const { forDate: _forDate, ...withoutDay } = recordCommand();
    const result = enqueue(EMPTY_OUTBOX, {
      kind: "record",
      localId: "a",
      habitName: "Dibujar",
      command: withoutDay,
    });
    expect(result).toEqual({ ok: false, reason: "noDay" });
  });

  it("keeps the order of unrelated items (OE-R1.S3)", () => {
    const state = queueOf(
      recordInput("a"),
      editInput("e1", "entry-1"),
      recordInput("b"),
      deleteInput("d1", "entry-2"),
    );
    expect(ids(state)).toEqual(["a", "e1", "b", "d1"]);
  });

  it("does not mutate the state it was given", () => {
    const before = queueOf(recordInput("a"));
    enqueue(before, recordInput("b"));
    expect(ids(before)).toEqual(["a"]);
  });

  it("refuses an edit or delete aimed at a local reference that is not queued", () => {
    expect(enqueue(EMPTY_OUTBOX, editInput("e1", localRef("ghost")))).toEqual({
      ok: false,
      reason: "unknownLocal",
    });
    expect(enqueue(EMPTY_OUTBOX, deleteInput("d1", localRef("ghost")))).toEqual({
      ok: false,
      reason: "unknownLocal",
    });
  });
});

describe("coalescing", () => {
  it("rewrites a never-attempted record in place when it is edited (OE-R2.S1)", () => {
    const state = queueOf(
      recordInput("a", { value: { kind: "quantity", value: "20" } }),
      editInput("e1", localRef("a"), "30", "más tiempo"),
    );
    expect(ids(state)).toEqual(["a"]);
    expect(recordOf(state, "a")?.command).toEqual(
      recordCommand({
        clientRequestId: "req-a",
        value: { kind: "quantity", value: "30" },
        note: "más tiempo",
      }),
    );
  });

  it("removes a never-attempted record when it is deleted: no request will ever be sent (OE-R2.S2)", () => {
    const state = queueOf(recordInput("a"), recordInput("b"), deleteInput("d1", localRef("a")));
    expect(ids(state)).toEqual(["b"]);
  });

  it("keeps an attempted record unchanged and appends a dependent edit (OE-R2.S3)", () => {
    const attempted = markAttempted(queueOf(recordInput("a")), "a");
    const record = recordOf(attempted, "a");
    const state = applyAll(attempted, editInput("e1", localRef("a"), "45"));
    expect(recordOf(state, "a")).toEqual(record);
    expect(ids(state)).toEqual(["a", "e1"]);
    expect(state.items[1]).toMatchObject({ kind: "edit", target: localRef("a") });
  });

  it("keeps only the latest edit of a target (OE-R2.S4)", () => {
    const state = queueOf(
      editInput("e1", "entry-1", "20"),
      recordInput("b"),
      editInput("e2", "entry-1", "40", "otra"),
    );
    expect(ids(state)).toEqual(["e2", "b"]);
    expect(state.items[0]).toMatchObject({
      value: { kind: "quantity", value: "40" },
      note: "otra",
    });
  });

  it("keeps only the latest edit of a dependent target too", () => {
    const attempted = markAttempted(queueOf(recordInput("a")), "a");
    const state = applyAll(
      attempted,
      editInput("e1", localRef("a"), "40"),
      editInput("e2", localRef("a"), "50"),
    );
    expect(ids(state)).toEqual(["a", "e2"]);
  });

  it("drops queued edits of a target when it is deleted, and queues one delete (OE-R2.S5)", () => {
    const state = queueOf(
      editInput("e1", "entry-1"),
      recordInput("b"),
      deleteInput("d1", "entry-1"),
    );
    expect(ids(state)).toEqual(["b", "d1"]);
  });

  it("drops the dependent edit when an attempted record is deleted, and queues the delete", () => {
    const attempted = markAttempted(queueOf(recordInput("a")), "a");
    const state = applyAll(
      attempted,
      editInput("e1", localRef("a")),
      deleteInput("d1", localRef("a")),
    );
    expect(ids(state)).toEqual(["a", "d1"]);
  });

  it("does not queue the same delete twice", () => {
    const state = queueOf(deleteInput("d1", "entry-1"), deleteInput("d2", "entry-1"));
    expect(ids(state)).toEqual(["d1"]);
  });
});

describe("markAttempted", () => {
  it("flags only that record", () => {
    const state = markAttempted(queueOf(recordInput("a"), recordInput("b")), "a");
    expect(recordOf(state, "a")?.attempted).toBe(true);
    expect(recordOf(state, "b")?.attempted).toBe(false);
  });
});

describe("resolveRecord", () => {
  it("removes the sent record and points its dependants at the server entry", () => {
    const attempted = markAttempted(queueOf(recordInput("a")), "a");
    const state = resolveRecord(
      applyAll(attempted, editInput("e1", localRef("a"), "45")),
      "a",
      "entry-77",
    );
    expect(ids(state)).toEqual(["e1"]);
    expect(state.items[0]).toMatchObject({ kind: "edit", target: "entry-77" });
  });

  it("retargets a dependent delete as well", () => {
    const attempted = markAttempted(queueOf(recordInput("a")), "a");
    const state = resolveRecord(
      applyAll(attempted, deleteInput("d1", localRef("a"))),
      "a",
      "entry-77",
    );
    expect(state.items).toEqual([expect.objectContaining({ kind: "delete", target: "entry-77" })]);
  });

  it("leaves unrelated items alone", () => {
    const state = resolveRecord(
      queueOf(recordInput("a"), editInput("e1", "entry-1")),
      "a",
      "entry-77",
    );
    expect(state.items).toEqual([expect.objectContaining({ id: "e1", target: "entry-1" })]);
  });
});

describe("removeItem and rejectItem", () => {
  it("removeItem takes out one item by id", () => {
    const state = removeItem(queueOf(recordInput("a"), editInput("e1", "entry-1")), "e1");
    expect(ids(state)).toEqual(["a"]);
  });

  it("rejectItem removes a record with its dependants and reports all of them (OE-R4.S6)", () => {
    const attempted = markAttempted(queueOf(recordInput("a"), recordInput("b")), "a");
    const withEdit = applyAll(attempted, editInput("e1", localRef("a")));
    const { state, removed } = rejectItem(withEdit, "a");
    expect(ids(state)).toEqual(["b"]);
    expect(removed.map(itemId)).toEqual(["a", "e1"]);
  });

  it("rejectItem on a plain edit removes only that edit", () => {
    const { state, removed } = rejectItem(
      queueOf(editInput("e1", "entry-1"), recordInput("b")),
      "e1",
    );
    expect(ids(state)).toEqual(["b"]);
    expect(removed.map(itemId)).toEqual(["e1"]);
  });
});

describe("local references", () => {
  it("builds and recognises them", () => {
    expect(localRef("a")).toBe("local:a");
    expect(isLocalRef("local:a")).toBe(true);
    expect(isLocalRef("entry-1")).toBe(false);
  });

  it("dependantsOf lists the items aimed at a record's reference", () => {
    const attempted = markAttempted(queueOf(recordInput("a")), "a");
    const state = applyAll(attempted, editInput("e1", localRef("a")), editInput("e2", "entry-1"));
    const record = recordOf(state, "a") as OutboxItem as QueuedRecord;
    expect(dependantsOf(state, record).map(itemId)).toEqual(["e1"]);
  });
});
