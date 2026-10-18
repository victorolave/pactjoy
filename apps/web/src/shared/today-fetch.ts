import type { PactJoyApi } from "../ports/pactjoy-api.ts";
import { tick } from "./ordering.ts";

let settledStart: number | null = null;

/**
 * The one way to read Today. Several screens share the `["today"]` query and whichever observer
 * fires runs its own query function, so they all read through here: it notes when the fetch that
 * produced the data on screen STARTED (see `tick`). A fetch that was cancelled for a newer one
 * stands for nothing.
 */
export async function fetchToday(api: Pick<PactJoyApi, "getToday">, signal?: AbortSignal) {
  const startedAt = tick();
  const data = await api.getToday(signal);
  if (!signal?.aborted) settledStart = startedAt;
  return data;
}

/** When the fetch behind the latest Today answer started; null before any fetch finished. */
export const lastTodayFetchStart = (): number | null => settledStart;
