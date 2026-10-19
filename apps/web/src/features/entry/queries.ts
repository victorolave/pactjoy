import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { useClock } from "../../context/clock-context.tsx";
import { useConnectivity } from "../../context/connectivity-context.tsx";
import { useIds } from "../../context/ids-context.tsx";
import { ApiError } from "../../ports/api-error.ts";
import type {
  EditEntryCommand,
  RecordEntryCommand,
  RecordedEntry,
} from "../../ports/pactjoy-api.ts";
import { toUiError } from "../../shared/ui-error.ts";
import type { Outbox } from "./outbox/outbox.ts";
import { isLocalRef, localRef } from "./outbox/queue.ts";
import { useOutbox } from "./outbox/use-outbox.tsx";

/**
 * What a write does when it settles, given to the HOOK, not to each `mutate` call. TanStack drops the
 * per-call callbacks when the component that called `mutate` has unmounted (a sheet that closed, a
 * row that moved), so a toast or a state change that must follow the answer lives here: these run on
 * the mutation itself, mounted or not.
 */
export type WriteCallbacks<Data, Variables> = Pick<
  UseMutationOptions<Data, ApiError, Variables>,
  "onSuccess" | "onError"
>;

/** A record's answer: when `queued`, `entryId` is the local reference (`local:<id>`), not a server id. */
export type RecordResult = RecordedEntry & { readonly queued?: true };

/** An edit's or delete's answer: `queued` means it waits in the outbox for the connection. */
export interface WriteOutcome {
  readonly queued: boolean;
}

/** What a queued edit or delete needs to be told back to the member if the server rejects it. */
export interface EntryContext {
  readonly habitName: string;
  /** The day of the entry; null when the screen does not know it (then nothing is queued). */
  readonly forDate: string | null;
}

/**
 * Entry writes are send-or-queue (ADR-0012 addendum). A command goes straight to the API when the
 * device is online and nothing is waiting in the outbox; otherwise, or when a direct send is lost
 * (`NetworkError`), it is handed to the outbox, which keeps it on the phone and replays it in order.
 * A command that carries a photo is never queued: its upload slot expires. The query client
 * invalidates Today after every settled mutation (AC-R4), so the server stays the only source of
 * points; nothing here computes or guesses them.
 */
function useSendOrQueue() {
  const api = usePactJoyApi();
  const outbox = useOutbox();
  const connectivity = useConnectivity();
  const ids = useIds();
  const clock = useClock();
  // Asked when the write happens, not when the component rendered.
  const mustQueue = (box: Outbox): boolean =>
    connectivity?.isOnline() === false || box.snapshot().items.length > 0;
  return { api, outbox, ids, clock, mustQueue };
}

const isNetworkError = (error: unknown): boolean => toUiError(error).code === "NetworkError";

export function useRecordEntry(
  callbacks: WriteCallbacks<RecordResult, RecordEntryCommand> | undefined,
  habitName: string,
) {
  const { api, outbox, ids, mustQueue } = useSendOrQueue();
  return useMutation<RecordResult, ApiError, RecordEntryCommand>({
    mutationKey: ["entry", "record"],
    mutationFn: async (command) => {
      // No outbox, no day or a photo (its upload slot would expire): only a direct send is possible.
      if (outbox === null || command.forDate === undefined || (command.photoId ?? null) !== null) {
        return api.recordEntry(command);
      }
      const queue = (attempted: boolean): RecordResult | null => {
        const localId = ids.newId();
        const added = outbox.enqueue({
          kind: "record",
          localId,
          habitName,
          command,
          ...(attempted ? { attempted } : {}),
        });
        return added.ok ? { entryId: localRef(localId), replayed: false, queued: true } : null;
      };
      if (mustQueue(outbox)) {
        const queued = queue(false);
        if (queued !== null) return queued;
      }
      try {
        return await api.recordEntry(command);
      } catch (error) {
        if (isNetworkError(error)) {
          // The request left the phone: it may be on the server, so it can no longer be rewritten.
          const queued = queue(true);
          if (queued !== null) return queued;
        }
        throw error;
      }
    },
    ...callbacks,
  });
}

export function useEditEntry(
  callbacks: WriteCallbacks<WriteOutcome, EditEntryCommand> | undefined,
  context: EntryContext,
) {
  const { api, outbox, ids, clock, mustQueue } = useSendOrQueue();
  return useMutation<WriteOutcome, ApiError, EditEntryCommand>({
    mutationKey: ["entry", "edit"],
    mutationFn: async (command) => {
      // Taken now: a send cut off later is queued late, behind what the member did meanwhile (W1).
      const actedAt = clock.nowMs();
      const target = outbox?.resolve(command.entryId) ?? command.entryId;
      const withPhoto = command.photoId !== undefined;
      const direct = async (): Promise<WriteOutcome> => {
        await api.editEntry({ ...command, entryId: target });
        // An earlier edit still in flight must not be queued over this one if it fails later.
        outbox?.noteDirect(target, actedAt);
        return { queued: false };
      };
      const { forDate, habitName } = context;
      if (outbox === null || forDate === null) return direct();
      const queue = (): boolean =>
        outbox.enqueue({
          kind: "edit",
          id: ids.newId(),
          target,
          habitName,
          forDate,
          value: command.value,
          note: command.note,
          actedAt,
        }).ok;
      if (isLocalRef(target)) {
        // The record is still on the phone: only the outbox can reach it. A photo cannot ride along.
        if (withPhoto) throw new ApiError("NetworkError", 0, null);
        if (queue()) return { queued: true };
        throw new ApiError("EntryNotFound", 404, null);
      }
      if (!withPhoto && mustQueue(outbox) && queue()) return { queued: true };
      try {
        return await direct();
      } catch (error) {
        if (!withPhoto && isNetworkError(error) && queue()) return { queued: true };
        throw error;
      }
    },
    ...callbacks,
  });
}

export function useDeleteEntry(
  callbacks: WriteCallbacks<WriteOutcome, string> | undefined,
  context: EntryContext,
) {
  const { api, outbox, ids, clock, mustQueue } = useSendOrQueue();
  return useMutation<WriteOutcome, ApiError, string>({
    mutationKey: ["entry", "delete"],
    mutationFn: async (entryId) => {
      const actedAt = clock.nowMs();
      const target = outbox?.resolve(entryId) ?? entryId;
      const direct = async (): Promise<WriteOutcome> => {
        await api.deleteEntry(target);
        outbox?.noteDirect(target, actedAt);
        return { queued: false };
      };
      const { forDate, habitName } = context;
      if (outbox === null || forDate === null) return direct();
      const queue = (): boolean =>
        outbox.enqueue({
          kind: "delete",
          id: ids.newId(),
          target,
          habitName,
          forDate,
          actedAt,
        }).ok;
      if (isLocalRef(target)) {
        if (queue()) return { queued: true };
        throw new ApiError("EntryNotFound", 404, null);
      }
      if (mustQueue(outbox) && queue()) return { queued: true };
      try {
        return await direct();
      } catch (error) {
        if (isNetworkError(error) && queue()) return { queued: true };
        throw error;
      }
    },
    ...callbacks,
  });
}
