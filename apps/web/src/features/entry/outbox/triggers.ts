import type { Connectivity } from "../../../ports/connectivity.ts";
import type { Visibility } from "../../../ports/visibility.ts";
import type { Outbox } from "./outbox.ts";

/** Waits between replays while a retryable failure keeps items queued; the last one repeats. */
const BACKOFF_MS = [5_000, 15_000, 60_000, 300_000] as const;

export interface TriggerDeps {
  readonly outbox: Pick<Outbox, "drain" | "snapshot" | "onEnqueue">;
  readonly connectivity: Connectivity;
  readonly visibility: Visibility;
}

/**
 * When the outbox replays (OE-R4): on start, when the connection returns, when the app comes back to
 * the foreground, right after an enqueue while online, and with backoff while retryable items
 * remain. A service worker cannot do this: WebKit has no Background Sync and the worker holds no
 * tokens. Returns the function that stops everything.
 */
export function startReplayTriggers({ outbox, connectivity, visibility }: TriggerDeps): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let running = false;
  let stopped = false;

  const clearTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const replay = async () => {
    // A drain already in flight picks up whatever was queued meanwhile.
    if (stopped || running) return;
    if (!connectivity.isOnline() || outbox.snapshot().items.length === 0) return;
    clearTimer();
    running = true;
    const status = await outbox.drain().finally(() => {
      running = false;
    });
    if (stopped) return;
    if (status === "retry") {
      const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 300_000;
      failures += 1;
      timer = setTimeout(() => void replay(), wait);
    } else {
      failures = 0;
    }
  };

  const stopOnline = connectivity.subscribe((online) => {
    if (!online) return;
    failures = 0;
    void replay();
  });
  const stopVisible = visibility.subscribe((visible) => {
    if (visible) void replay();
  });
  const stopEnqueue = outbox.onEnqueue(() => void replay());
  void replay();

  return () => {
    stopped = true;
    clearTimer();
    stopOnline();
    stopVisible();
    stopEnqueue();
  };
}
