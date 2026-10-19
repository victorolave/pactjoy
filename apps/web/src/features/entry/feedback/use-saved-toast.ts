import { useToasts } from "../../../context/toast-context.tsx";
import type { EntryContext } from "../queries.ts";
import { useUndoEntry } from "./use-undo-entry.ts";

/**
 * The toast that follows a new registro (design 16, 20): the message and Deshacer. `context` names the
 * habit and day the undo would be queued for if the connection is gone.
 */
export function useSavedToast(context: EntryContext): (message: string, entryId: string) => void {
  const toasts = useToasts();
  const undo = useUndoEntry(context);
  return (message, entryId) =>
    toasts.show({
      message,
      actionLabel: "Deshacer",
      actionWorksOffline: true,
      onAction: () => undo(entryId),
    });
}
