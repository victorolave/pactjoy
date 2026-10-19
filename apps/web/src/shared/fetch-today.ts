import type { TodayView } from "@pactjoy/app";
import type { PactJoyApi } from "../ports/pactjoy-api.ts";
import { todayKey } from "./query-keys.ts";
import { fetchToday } from "./today-fetch.ts";

/** Every Today the server answered in this runtime, by identity. */
const fromServer = new WeakSet<TodayView>();

/**
 * The one way to read Today under `todayKey`: every screen sharing that cache uses these options,
 * so whichever of them fetches, the answer is recognised as the server's. A view restored from the
 * saved cache or written with `setQueryData` is another object, so it is never taken for one.
 * Structural sharing is off: it would keep an equal older object (a restored one, say) in place of
 * the server's answer. The fetch goes through `fetchToday`, which notes when it started: the outbox
 * settles the entries it sent with that.
 */
export const todayQuery = (api: PactJoyApi) => ({
  queryKey: todayKey,
  queryFn: async ({ signal }: { readonly signal: AbortSignal }) => {
    const view = await fetchToday(api, signal);
    fromServer.add(view);
    return view;
  },
  structuralSharing: false,
});

/** Whether this exact Today came from the server in this runtime (not from the saved cache). */
export const isServerToday = (view: TodayView | undefined): boolean =>
  view !== undefined && fromServer.has(view);
