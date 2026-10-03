import { useMutation } from "@tanstack/react-query";
import { usePactJoyApi } from "../../app/api-context.tsx";
import type { ApiError } from "../../ports/api-error.ts";
import type {
  EditEntryCommand,
  RecordEntryCommand,
  RecordedEntry,
} from "../../ports/pactjoy-api.ts";

/**
 * Writes. The query client invalidates Today after every settled mutation (AC-R4), so the server
 * stays the only source of points; nothing here computes or guesses them.
 */
export function useRecordEntry() {
  const api = usePactJoyApi();
  return useMutation<RecordedEntry, ApiError, RecordEntryCommand>({
    mutationKey: ["entry", "record"],
    mutationFn: (command) => api.recordEntry(command),
  });
}

export function useEditEntry() {
  const api = usePactJoyApi();
  return useMutation<void, ApiError, EditEntryCommand>({
    mutationKey: ["entry", "edit"],
    mutationFn: (command) => api.editEntry(command),
  });
}

export function useDeleteEntry() {
  const api = usePactJoyApi();
  return useMutation<void, ApiError, string>({
    mutationKey: ["entry", "delete"],
    mutationFn: (entryId) => api.deleteEntry(entryId),
  });
}
