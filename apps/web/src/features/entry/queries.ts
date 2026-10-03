import { type UseMutationOptions, useMutation } from "@tanstack/react-query";
import { usePactJoyApi } from "../../app/api-context.tsx";
import type { ApiError } from "../../ports/api-error.ts";
import type {
  EditEntryCommand,
  RecordEntryCommand,
  RecordedEntry,
} from "../../ports/pactjoy-api.ts";

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

/**
 * Writes. The query client invalidates Today after every settled mutation (AC-R4), so the server
 * stays the only source of points; nothing here computes or guesses them.
 */
export function useRecordEntry(callbacks?: WriteCallbacks<RecordedEntry, RecordEntryCommand>) {
  const api = usePactJoyApi();
  return useMutation<RecordedEntry, ApiError, RecordEntryCommand>({
    mutationKey: ["entry", "record"],
    mutationFn: (command) => api.recordEntry(command),
    ...callbacks,
  });
}

export function useEditEntry(callbacks?: WriteCallbacks<void, EditEntryCommand>) {
  const api = usePactJoyApi();
  return useMutation<void, ApiError, EditEntryCommand>({
    mutationKey: ["entry", "edit"],
    mutationFn: (command) => api.editEntry(command),
    ...callbacks,
  });
}

export function useDeleteEntry(callbacks?: WriteCallbacks<void, string>) {
  const api = usePactJoyApi();
  return useMutation<void, ApiError, string>({
    mutationKey: ["entry", "delete"],
    mutationFn: (entryId) => api.deleteEntry(entryId),
    ...callbacks,
  });
}
