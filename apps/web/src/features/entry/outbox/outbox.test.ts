import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { EMPTY_OUTBOX, type OutboxState } from "../../../ports/outbox-store.ts";
import type { RecordEntryCommand } from "../../../ports/pactjoy-api.ts";
import { FakePactJoyApi } from "../../../testing/fake-pactjoy-api.ts";
import { noCircleTodayFixture } from "../../../testing/fixtures/today.ts";
import { MemoryOutboxStore } from "../../../testing/memory-outbox-store.ts";
import { SequentialIds } from "../../../testing/sequential-ids.ts";
import { Outbox } from "./outbox.ts";
import { type EnqueueInput, enqueue, localRef, markAttempted } from "./queue.ts";

const USER = "user-1";

const recordInput = (
  localId: string,
  overrides: Partial<RecordEntryCommand> = {},
): EnqueueInput => ({
  kind: "record",
  localId,
  habitName: "Leer",
  command: {
    seasonId: "s1",
    commitmentId: "c1",
    forDate: "2026-10-13",
    value: { kind: "done" },
    note: null,
    clientRequestId: `req-${localId}`,
    ...overrides,
  },
});

const editInput = (id: string, target: string): EnqueueInput => ({
  kind: "edit",
  id,
  target,
  habitName: "Leer",
  forDate: "2026-10-13",
  value: { kind: "quantity", value: "45" },
  note: "capítulo 3",
});

const deleteInput = (id: string, target: string): EnqueueInput => ({
  kind: "delete",
  id,
  target,
  habitName: "Leer",
  forDate: "2026-10-13",
});

const apiError = (code: string, status = 422) => new ApiError(code, status, "req");

/** A state as the queue model would have left it, for tests that need an attempted record. */
function seeded(...steps: readonly (EnqueueInput | { readonly attempt: string })[]): OutboxState {
  return steps.reduce<OutboxState>((state, step) => {
    if ("attempt" in step) return markAttempted(state, step.attempt);
    const result = enqueue(state, step);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result.state;
  }, EMPTY_OUTBOX);
}

function setup(initial: OutboxState = EMPTY_OUTBOX) {
  const api = new FakePactJoyApi(noCircleTodayFixture());
  const store = new MemoryOutboxStore();
  store.save(USER, initial);
  const onReplayed = vi.fn();
  const outbox = new Outbox({ api, store, userId: USER, ids: new SequentialIds(), onReplayed });
  const queue = (input: EnqueueInput) => {
    const result = outbox.enqueue(input);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
  };
  return { api, store, outbox, onReplayed, queue };
}

const queuedIds = (outbox: Outbox) =>
  outbox.snapshot().items.map((item) => (item.kind === "record" ? item.localId : item.id));

describe("Outbox.drain: order and persistence (OE-R4)", () => {
  it("sends the queued items in order, one after another (OE-R4.S1)", async () => {
    const { api, outbox, queue, onReplayed } = setup();
    queue(recordInput("a"));
    queue(recordInput("b"));
    queue(recordInput("c"));
    const release = api.hold("recordEntry");
    const done = outbox.drain();
    await vi.waitFor(() => expect(api.recordAttempts).toHaveLength(1));
    // The second is not sent while the first is still in flight.
    expect(api.recordAttempts.map((cmd) => cmd.clientRequestId)).toEqual(["req-a"]);
    release();
    expect(await done).toBe("done");
    expect(api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-a", "req-b", "req-c"]);
    expect(outbox.snapshot().items).toEqual([]);
    expect(onReplayed).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and does not report a replay, for an empty queue", async () => {
    const { outbox, onReplayed } = setup();
    expect(await outbox.drain()).toBe("done");
    expect(onReplayed).not.toHaveBeenCalled();
  });

  it("saves the attempted flag before the request goes out (OE-R2)", async () => {
    const { api, store, outbox, queue } = setup();
    queue(recordInput("a"));
    const release = api.hold("recordEntry");
    const done = outbox.drain();
    await vi.waitFor(() => expect(api.recordAttempts).toHaveLength(1));
    const stored = store.load(USER).items[0];
    expect(stored).toMatchObject({ kind: "record", localId: "a", attempted: true });
    release();
    await done;
  });

  it("points a dependant at the server entry once its record is sent", async () => {
    const { api, outbox, queue } = setup();
    queue(recordInput("a"));
    const release = api.hold("recordEntry");
    const done = outbox.drain();
    await vi.waitFor(() => expect(api.recordAttempts).toHaveLength(1));
    // Now attempted: the edit waits behind it, aimed at the local reference.
    queue(editInput("e1", localRef("a")));
    release();
    await done;
    expect(api.edited).toEqual([
      { entryId: "entry-1", value: { kind: "quantity", value: "45" }, note: "capítulo 3" },
    ]);
    expect(outbox.snapshot().items).toEqual([]);
  });

  it("persists every change so a restart finds the same queue (OE-R3.S1)", async () => {
    const { store, queue } = setup();
    queue(recordInput("a"));
    queue(recordInput("b"));
    const restarted = new Outbox({
      api: new FakePactJoyApi(noCircleTodayFixture()),
      store,
      userId: USER,
      ids: new SequentialIds(),
      onReplayed: () => undefined,
    });
    expect(queuedIds(restarted)).toEqual(["a", "b"]);
  });

  it("joins a drain already running instead of starting a second one", async () => {
    const { api, outbox, queue } = setup();
    queue(recordInput("a"));
    const release = api.hold("recordEntry");
    const first = outbox.drain();
    const second = outbox.drain();
    await vi.waitFor(() => expect(api.recordAttempts).toHaveLength(1));
    release();
    expect(await Promise.all([first, second])).toEqual(["done", "done"]);
    expect(api.recordAttempts).toHaveLength(1);
  });

  it("picks up an item queued while it was draining", async () => {
    const { api, outbox, queue } = setup();
    queue(recordInput("a"));
    const release = api.hold("recordEntry");
    const done = outbox.drain();
    await vi.waitFor(() => expect(api.recordAttempts).toHaveLength(1));
    queue(recordInput("b"));
    release();
    await done;
    expect(api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-a", "req-b"]);
  });
});

describe("Outbox.drain: classes of answer (OE-R4)", () => {
  it("a terminal answer removes the item with a notice and the next is still sent (OE-R4.S5)", async () => {
    const { api, outbox, queue } = setup();
    queue(recordInput("a"));
    queue(recordInput("b"));
    api.failNext("recordEntry", apiError("WindowClosed"));
    expect(await outbox.drain()).toBe("done");
    expect(api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-b"]);
    expect(outbox.snapshot().notices).toEqual([
      expect.objectContaining({ habitName: "Leer", forDate: "2026-10-13", reason: "closedWindow" }),
    ]);
  });

  it.each([
    ["OpportunityPaused", "paused"],
    ["OpportunityOnHold", "onHold"],
    ["SeasonNotActive", "closedWindow"],
    ["NotAMember", "generic"],
  ])(
    "%s is terminal with the reason %s and the replay goes on (OE-R4.S10)",
    async (code, reason) => {
      const { api, outbox, queue } = setup();
      queue(recordInput("a"));
      queue(recordInput("b"));
      api.failNext("recordEntry", apiError(code));
      await outbox.drain();
      expect(outbox.snapshot().notices[0]?.reason).toBe(reason);
      expect(api.recorded).toHaveLength(1);
    },
  );

  it("removes the dependants of a rejected record without any request (OE-R4.S6)", async () => {
    const { api, outbox } = setup(
      seeded(recordInput("a"), { attempt: "a" }, editInput("e1", localRef("a"))),
    );
    api.failNext("recordEntry", apiError("WindowClosed"));
    await outbox.drain();
    expect(api.edited).toEqual([]);
    expect(outbox.snapshot().items).toEqual([]);
    expect(outbox.snapshot().notices).toHaveLength(1);
  });

  it("a network failure on the first item stops the replay and keeps everything in order", async () => {
    const { api, outbox, queue, onReplayed } = setup();
    queue(recordInput("a"));
    queue(recordInput("b"));
    api.failNext("recordEntry", new ApiError("NetworkError", 0, null));
    expect(await outbox.drain()).toBe("retry");
    expect(queuedIds(outbox)).toEqual(["a", "b"]);
    expect(api.recordAttempts).toHaveLength(1);
    expect(onReplayed).not.toHaveBeenCalled();
  });

  it("a network drop mid-replay keeps the rest in order and resumes on the next drain (OE-R4.S7)", async () => {
    const { api, outbox, queue, onReplayed } = setup();
    queue(recordInput("a"));
    queue(recordInput("b"));
    queue(recordInput("c"));
    // The first call succeeds (nothing scripted), the second fails.
    const original = api.recordEntry.bind(api);
    let calls = 0;
    api.recordEntry = async (cmd) => {
      calls += 1;
      if (calls === 2) throw new ApiError("NetworkError", 0, null);
      return original(cmd);
    };
    expect(await outbox.drain()).toBe("retry");
    expect(queuedIds(outbox)).toEqual(["b", "c"]);
    expect(onReplayed).toHaveBeenCalledTimes(1);
    expect(await outbox.drain()).toBe("done");
    expect(queuedIds(outbox)).toEqual([]);
    expect(api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-a", "req-b", "req-c"]);
  });

  it.each(["ServiceUnavailable", "Internal"])(
    "%s is retryable and keeps the item",
    async (code) => {
      const { api, outbox, queue } = setup();
      queue(recordInput("a"));
      api.failNext("recordEntry", apiError(code, 503));
      expect(await outbox.drain()).toBe("retry");
      expect(queuedIds(outbox)).toEqual(["a"]);
      expect(outbox.snapshot().notices).toEqual([]);
    },
  );

  it("retries a concurrency conflict up to three times, then rejects it", async () => {
    vi.useFakeTimers();
    const { api, outbox, queue } = setup();
    queue(recordInput("a"));
    for (let n = 0; n < 4; n += 1)
      api.failNext("recordEntry", apiError("ConcurrencyConflict", 409));
    const done = outbox.drain();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await done).toBe("done");
    expect(api.recordAttempts).toHaveLength(4);
    expect(outbox.snapshot().items).toEqual([]);
    expect(outbox.snapshot().notices).toHaveLength(1);
  });

  it("a conflict that clears within the retries is sent", async () => {
    vi.useFakeTimers();
    const { api, outbox, queue } = setup();
    queue(recordInput("a"));
    api.failNext("recordEntry", apiError("ConcurrencyConflict", 409));
    api.failNext("recordEntry", apiError("ConcurrencyConflict", 409));
    const done = outbox.drain();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await done).toBe("done");
    expect(api.recorded).toHaveLength(1);
    expect(outbox.snapshot().notices).toEqual([]);
  });

  it("waits between conflict retries instead of hammering the server", async () => {
    vi.useFakeTimers();
    try {
      const { api, outbox, queue } = setup();
      queue(recordInput("a"));
      api.failNext("recordEntry", apiError("ConcurrencyConflict", 409));
      const done = outbox.drain();
      await vi.advanceTimersByTimeAsync(0);
      expect(api.recordAttempts).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(499);
      expect(api.recordAttempts).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await done).toBe("done");
      expect(api.recordAttempts).toHaveLength(2);
      expect(api.recorded).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unauthorized answer stops the replay and keeps the queue (session rules apply)", async () => {
    const { api, outbox, queue } = setup();
    queue(recordInput("a"));
    queue(recordInput("b"));
    api.failNext("recordEntry", apiError("Unauthorized", 401));
    expect(await outbox.drain()).toBe("session");
    expect(queuedIds(outbox)).toEqual(["a", "b"]);
    expect(api.recordAttempts).toHaveLength(1);
  });

  it("a record deleted before it was confirmed settles with its delete: no notice, no delete request", async () => {
    const { api, outbox } = setup(
      seeded(recordInput("a"), { attempt: "a" }, deleteInput("d1", localRef("a"))),
    );
    api.failNext("recordEntry", apiError("EntryDeleted", 410));
    expect(await outbox.drain()).toBe("done");
    expect(api.deleted).toEqual([]);
    expect(outbox.snapshot()).toEqual(EMPTY_OUTBOX);
  });
});

describe("Outbox.drain: idempotency and the day (OE-R4)", () => {
  it("a record whose answer was lost counts as sent when the server says replayed (OE-R4.S3)", async () => {
    const { api, outbox, queue } = setup();
    queue(recordInput("a"));
    // The first send reached the server; the phone never heard back.
    await api.recordEntry({
      seasonId: "s1",
      commitmentId: "c1",
      forDate: "2026-10-13",
      value: { kind: "done" },
      note: null,
      clientRequestId: "req-a",
    });
    expect(await outbox.drain()).toBe("done");
    expect(outbox.snapshot().items).toEqual([]);
    expect(outbox.snapshot().notices).toEqual([]);
  });

  it("sends the record with the day it was queued for, whenever it is sent (OE-R4.S4)", async () => {
    const { api, outbox, queue } = setup();
    queue(recordInput("a", { forDate: "2026-10-13" }));
    await outbox.drain();
    expect(api.recorded[0]?.forDate).toBe("2026-10-13");
  });

  it("sends an edit as a full-state PUT without a photoId (OE-R4.S8)", async () => {
    const { api, outbox, queue } = setup();
    queue(editInput("e1", "entry-9"));
    await outbox.drain();
    expect(api.edited).toEqual([
      { entryId: "entry-9", value: { kind: "quantity", value: "45" }, note: "capítulo 3" },
    ]);
    expect(api.edited[0]).not.toHaveProperty("photoId");
  });

  it("an edit of an entry deleted elsewhere is removed with an entry-gone notice (OE-R4.S9)", async () => {
    const { api, outbox, queue } = setup();
    queue(editInput("e1", "entry-9"));
    api.failNext("editEntry", apiError("EntryDeleted", 410));
    await outbox.drain();
    expect(outbox.snapshot().notices).toEqual([
      expect.objectContaining({ action: "edit", reason: "entryGone" }),
    ]);
  });

  it("an edit refused for a closed window says it could not be confirmed (OE-R5.S2)", async () => {
    const { api, outbox, queue } = setup();
    queue(editInput("e1", "entry-9"));
    api.failNext("editEntry", apiError("WindowClosed"));
    await outbox.drain();
    expect(outbox.snapshot().notices[0]).toMatchObject({ action: "edit", reason: "unconfirmed" });
  });

  it("never sends a local reference to the server: an orphaned edit is rejected as gone", async () => {
    const { api, outbox } = setup({
      ...EMPTY_OUTBOX,
      items: [
        {
          kind: "edit",
          id: "e1",
          target: localRef("ghost"),
          habitName: "Leer",
          forDate: "2026-10-13",
          value: { kind: "done" },
          note: null,
        },
      ],
    });
    await outbox.drain();
    expect(api.edited).toEqual([]);
    expect(outbox.snapshot().notices[0]).toMatchObject({ action: "edit", reason: "entryGone" });
  });

  it("a delete of an entry that is already gone counts as sent, with no notice", async () => {
    const { api, outbox, queue } = setup();
    queue(deleteInput("d1", "entry-9"));
    api.failNext("deleteEntry", apiError("EntryNotFound", 404));
    await outbox.drain();
    expect(outbox.snapshot()).toEqual(EMPTY_OUTBOX);
  });
});

describe("Outbox.replaying: the syncing flag (OE-R9)", () => {
  it("is true from the start of a replay with items until it settles, and tells subscribers", async () => {
    const { api, outbox, queue } = setup();
    queue(recordInput("a"));
    const listener = vi.fn();
    outbox.subscribe(listener);
    expect(outbox.replaying()).toBe(false);
    const release = api.hold("recordEntry");
    const done = outbox.drain();
    await vi.waitFor(() => expect(api.recordAttempts).toHaveLength(1));
    expect(outbox.replaying()).toBe(true);
    release();
    await done;
    expect(outbox.replaying()).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it("stays false for a replay of an empty queue", async () => {
    const { outbox } = setup();
    const listener = vi.fn();
    outbox.subscribe(listener);
    await outbox.drain();
    expect(outbox.replaying()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("is false again when the replay stopped on a retryable error", async () => {
    const { api, outbox, queue } = setup();
    queue(recordInput("a"));
    api.failNext("recordEntry", new ApiError("NetworkError", 0, null));
    await outbox.drain();
    expect(outbox.replaying()).toBe(false);
  });
});

describe("Outbox: two tabs of the same user share one store (OE-R3.S4)", () => {
  function twoTabs(initial: OutboxState) {
    const api = new FakePactJoyApi(noCircleTodayFixture());
    const store = new MemoryOutboxStore();
    store.save(USER, initial);
    const make = () => {
      const outbox = new Outbox({
        api,
        store,
        userId: USER,
        ids: new SequentialIds(),
        onReplayed: () => undefined,
      });
      outbox.subscribe(() => undefined);
      return outbox;
    };
    return { api, store, tabA: make(), tabB: make() };
  }

  it("two replays at once create each entry once and leave both queues and the store empty", async () => {
    const { api, store, tabA, tabB } = twoTabs(
      seeded(recordInput("a"), recordInput("b"), editInput("e1", "entry-7")),
    );
    await Promise.all([tabA.drain(), tabB.drain()]);
    // The same request ids reach the server twice at most; the server answers `replayed` and so
    // never holds a duplicate entry.
    const created = new Set(api.recorded.map((cmd) => cmd.clientRequestId));
    expect([...created].sort()).toEqual(["req-a", "req-b"]);
    expect(api.recorded.length).toBeGreaterThanOrEqual(2);
    expect(api.recorded.length).toBeLessThanOrEqual(4);
    expect(tabA.snapshot().items).toEqual([]);
    expect(tabB.snapshot().items).toEqual([]);
    expect(store.load(USER).items).toEqual([]);
    expect(tabA.snapshot().notices).toEqual([]);
    expect(tabB.snapshot().notices).toEqual([]);
  });

  it("an item another tab queues while this one replays is not lost", async () => {
    const { api, store, tabA } = twoTabs(seeded(recordInput("a")));
    const release = api.hold("recordEntry");
    const done = tabA.drain();
    await vi.waitFor(() => expect(api.recordAttempts).toHaveLength(1));
    // The other tab saves its own item next to the one being sent.
    store.emitExternal(USER, seeded(recordInput("a"), { attempt: "a" }, recordInput("c")));
    release();
    await done;
    expect(api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-a", "req-c"]);
    expect(tabA.snapshot().items).toEqual([]);
  });
});

describe("Outbox state: notices, listeners, erasure", () => {
  it("keeps a notice across a restart until it is dismissed (OE-R5.S1)", async () => {
    const { api, store, outbox, queue } = setup();
    queue(recordInput("a"));
    api.failNext("recordEntry", apiError("WindowClosed"));
    await outbox.drain();
    const restarted = new Outbox({
      api,
      store,
      userId: USER,
      ids: new SequentialIds(),
      onReplayed: () => undefined,
    });
    expect(restarted.snapshot().notices).toHaveLength(1);
    restarted.dismissNotices();
    expect(restarted.snapshot().notices).toEqual([]);
    expect(store.load(USER).notices).toEqual([]);
  });

  it("notifies subscribers of every change and returns a stable snapshot between them", () => {
    const { outbox, queue } = setup();
    const listener = vi.fn();
    outbox.subscribe(listener);
    const before = outbox.snapshot();
    expect(outbox.snapshot()).toBe(before);
    queue(recordInput("a"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(outbox.snapshot()).not.toBe(before);
  });

  it("tells enqueue listeners about an accepted command only", () => {
    const { outbox, queue } = setup();
    const onEnqueue = vi.fn();
    outbox.onEnqueue(onEnqueue);
    queue(recordInput("a"));
    expect(onEnqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue(recordInput("b", { photoId: "photo-1" }))).toEqual({
      ok: false,
      reason: "photo",
    });
    expect(onEnqueue).toHaveBeenCalledTimes(1);
  });

  it("follows another tab's change to the stored state (OE-R3.S4)", () => {
    const { store, outbox } = setup();
    const listener = vi.fn();
    outbox.subscribe(listener);
    store.emitExternal(USER, seeded(recordInput("x")));
    expect(queuedIds(outbox)).toEqual(["x"]);
    expect(listener).toHaveBeenCalled();
  });

  it("a session that ends mid-replay leaves nothing behind: the replay stops and nothing is written back (OE-R6)", async () => {
    const { api, store, outbox, queue } = setup();
    queue(recordInput("a"));
    queue(recordInput("b"));
    // No subscriber: the user is on a screen that does not show the queue.
    const release = api.hold("recordEntry");
    const done = outbox.drain();
    await vi.waitFor(() => expect(api.recordAttempts).toHaveLength(1));
    store.clearAll();
    expect(outbox.snapshot()).toEqual(EMPTY_OUTBOX);
    release();
    await done;
    expect(api.recordAttempts).toHaveLength(1);
    expect(store.load(USER)).toEqual(EMPTY_OUTBOX);
    expect(outbox.snapshot()).toEqual(EMPTY_OUTBOX);
  });

  it("follows the store with no subscribers at all", () => {
    const { store, outbox } = setup();
    store.emitExternal(USER, seeded(recordInput("x")));
    expect(queuedIds(outbox)).toEqual(["x"]);
  });

  it("an idle outbox's enqueue survives the commit of another one on the same store", async () => {
    const { api, store, outbox, queue } = setup();
    const idle = new Outbox({
      api,
      store,
      userId: USER,
      ids: new SequentialIds(),
      onReplayed: vi.fn(),
    });
    queue(recordInput("a"));
    store.emitExternal(USER, store.load(USER));
    const release = api.hold("recordEntry");
    const done = outbox.drain();
    await vi.waitFor(() => expect(api.recordAttempts).toHaveLength(1));
    // Another tab records while this one is sending, and the browser tells this tab.
    idle.enqueue(recordInput("b"));
    store.emitExternal(USER, idle.snapshot());
    release();
    await done;
    expect(store.load(USER)).toEqual(EMPTY_OUTBOX);
    expect(api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-a", "req-b"]);
  });

  it("dispose() stops it for good: no write back, no following, no stale references", async () => {
    const { api, store, outbox, queue } = setup();
    queue(recordInput("a"));
    queue(recordInput("b"));
    const release = api.hold("recordEntry");
    const done = outbox.drain();
    await vi.waitFor(() => expect(api.recordAttempts).toHaveLength(1));
    const before = store.load(USER);
    outbox.dispose();
    release();
    await done;
    expect(api.recordAttempts).toHaveLength(1);
    expect(store.load(USER)).toBe(before);
    store.emitExternal(USER, seeded(recordInput("x")));
    expect(queuedIds(outbox)).not.toContain("x");
    expect(outbox.resolve(localRef("a"))).toBe(localRef("a"));
  });

  it("resolve() maps the local reference of a record that was sent to its server entry", async () => {
    const { outbox, queue } = setup();
    queue(recordInput("a"));
    // Still queued: the reference is all there is.
    expect(outbox.resolve(localRef("a"))).toBe(localRef("a"));
    await outbox.drain();
    // An undo toast that still holds the reference reaches the server entry.
    expect(outbox.resolve(localRef("a"))).toBe("entry-1");
    expect(outbox.resolve("entry-9")).toBe("entry-9");
    expect(outbox.resolve(localRef("ghost"))).toBe(localRef("ghost"));
  });

  it("keeps a sent record until a fetched Today holds it; a sent edit changes it, a sent delete drops it", async () => {
    const { outbox, queue } = setup();
    queue(recordInput("a"));
    queue(recordInput("b"));
    queue(recordInput("c"));
    await outbox.drain();
    expect(outbox.sentRecords().map((record) => record.entryId)).toEqual([
      "entry-1",
      "entry-2",
      "entry-3",
    ]);
    queue(editInput("e1", "entry-1"));
    queue(deleteInput("d1", "entry-2"));
    await outbox.drain();
    expect(outbox.sentRecords().map((record) => record.entryId)).toEqual(["entry-1", "entry-3"]);
    expect(outbox.sentRecords()[0]?.command.value).toEqual({ kind: "quantity", value: "45" });
    outbox.acknowledge(new Set(["entry-1"]));
    expect(outbox.sentRecords().map((record) => record.entryId)).toEqual(["entry-3"]);
    outbox.dispose();
    expect(outbox.sentRecords()).toEqual([]);
  });

  it("resolve() forgets the mapping when the outbox is disposed", async () => {
    const { outbox, queue } = setup();
    queue(recordInput("a"));
    await outbox.drain();
    outbox.dispose();
    expect(outbox.resolve(localRef("a"))).toBe(localRef("a"));
  });
});
