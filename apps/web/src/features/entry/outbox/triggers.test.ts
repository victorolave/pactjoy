import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_OUTBOX, type OutboxState } from "../../../ports/outbox-store.ts";
import { FakeConnectivity } from "../../../testing/fake-connectivity.ts";
import { FakeVisibility } from "../../../testing/fake-visibility.ts";
import type { DrainStatus } from "./outbox.ts";
import { startReplayTriggers } from "./triggers.ts";

const WITH_ITEM: OutboxState = {
  ...EMPTY_OUTBOX,
  items: [
    {
      kind: "delete",
      id: "d1",
      target: "entry-1",
      habitName: "Leer",
      forDate: "2026-10-13",
    },
  ],
};

/** An outbox double: `statuses` is what each drain answers, the last one repeating. */
function fakeOutbox(initial: OutboxState, statuses: readonly DrainStatus[] = ["done"]) {
  let state = initial;
  let enqueued: (() => void) | null = null;
  let calls = 0;
  return {
    drain: vi.fn(async (): Promise<DrainStatus> => {
      const status = statuses[Math.min(calls, statuses.length - 1)] ?? "done";
      calls += 1;
      return status;
    }),
    snapshot: () => state,
    onEnqueue(listener: () => void) {
      enqueued = listener;
      return () => {
        enqueued = null;
      };
    },
    /** Simulates `enqueue`: the state gains an item, then the listeners hear about it. */
    enqueueItem() {
      state = WITH_ITEM;
      enqueued?.();
    },
    isListening: () => enqueued !== null,
  };
}

function setup(options: {
  state?: OutboxState;
  online?: boolean;
  visible?: boolean;
  statuses?: readonly DrainStatus[];
}) {
  const outbox = fakeOutbox(options.state ?? WITH_ITEM, options.statuses);
  const connectivity = new FakeConnectivity(options.online ?? true);
  const visibility = new FakeVisibility(options.visible ?? true);
  const stop = startReplayTriggers({ outbox, connectivity, visibility });
  return { outbox, connectivity, visibility, stop };
}

describe("startReplayTriggers (OE-R4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("replays on start when the queue has items and the device is online (OE-R4.S2)", async () => {
    const { outbox } = setup({});
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.drain).toHaveBeenCalledTimes(1);
  });

  it("does not replay on start offline or with an empty queue", async () => {
    const offline = setup({ online: false });
    const empty = setup({ state: EMPTY_OUTBOX });
    await vi.advanceTimersByTimeAsync(0);
    expect(offline.outbox.drain).not.toHaveBeenCalled();
    expect(empty.outbox.drain).not.toHaveBeenCalled();
  });

  it("replays when the connection returns, and ignores it going away (OE-R4.S1)", async () => {
    const { outbox, connectivity } = setup({ online: false });
    connectivity.setOnline(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.drain).not.toHaveBeenCalled();
    connectivity.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.drain).toHaveBeenCalledTimes(1);
  });

  it("replays when the app becomes visible, not when it is hidden", async () => {
    const { outbox, visibility } = setup({ state: EMPTY_OUTBOX });
    outbox.enqueueItem();
    await vi.advanceTimersByTimeAsync(0);
    outbox.drain.mockClear();
    visibility.setVisible(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.drain).not.toHaveBeenCalled();
    visibility.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.drain).toHaveBeenCalledTimes(1);
  });

  it("replays right after an enqueue while online, not while offline", async () => {
    const online = setup({ state: EMPTY_OUTBOX });
    online.outbox.enqueueItem();
    await vi.advanceTimersByTimeAsync(0);
    expect(online.outbox.drain).toHaveBeenCalledTimes(1);
    const offline = setup({ state: EMPTY_OUTBOX, online: false });
    offline.outbox.enqueueItem();
    await vi.advanceTimersByTimeAsync(0);
    expect(offline.outbox.drain).not.toHaveBeenCalled();
  });

  it("backs off 5 s, 15 s, 60 s and then every 5 min while retryable items remain", async () => {
    const { outbox } = setup({ statuses: ["retry"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.drain).toHaveBeenCalledTimes(1);
    const waits = [5_000, 15_000, 60_000, 300_000, 300_000];
    let expected = 1;
    for (const wait of waits) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(outbox.drain).toHaveBeenCalledTimes(expected);
      await vi.advanceTimersByTimeAsync(1);
      expected += 1;
      expect(outbox.drain).toHaveBeenCalledTimes(expected);
    }
  });

  it("stops retrying once a drain succeeds, and starts the schedule over after", async () => {
    const { outbox } = setup({ statuses: ["retry", "done"] });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(outbox.drain).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(outbox.drain).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a retry after the session is gone", async () => {
    const { outbox } = setup({ statuses: ["session"] });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(outbox.drain).toHaveBeenCalledTimes(1);
  });

  it("a backoff timer that fires offline waits for the connection instead", async () => {
    const { outbox, connectivity } = setup({ statuses: ["retry", "done"] });
    await vi.advanceTimersByTimeAsync(0);
    connectivity.setOnline(false);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(outbox.drain).toHaveBeenCalledTimes(1);
    connectivity.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.drain).toHaveBeenCalledTimes(2);
  });

  it("the connection returning resets the backoff and replays at once", async () => {
    const { outbox, connectivity } = setup({ statuses: ["retry"] });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(outbox.drain).toHaveBeenCalledTimes(3);
    connectivity.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.drain).toHaveBeenCalledTimes(4);
    // The schedule starts over: the next retry is 5 s away, not 60 s.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(outbox.drain).toHaveBeenCalledTimes(5);
  });

  it("stop() clears the timer and every subscription", async () => {
    const { outbox, connectivity, visibility, stop } = setup({ statuses: ["retry"] });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(600_000);
    connectivity.setOnline(true);
    visibility.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.drain).toHaveBeenCalledTimes(1);
    expect(outbox.isListening()).toBe(false);
  });
});
