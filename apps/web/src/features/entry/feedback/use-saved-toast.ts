import { useToasts } from "../../../context/toast-context.tsx";
import { useUndoEntry } from "./use-undo-entry.ts";

/** The toast that follows a new registro (design 16, 20): the message and Deshacer. */
export function useSavedToast(): (message: string, entryId: string) => void {
  const toasts = useToasts();
  const undo = useUndoEntry();
  return (message, entryId) =>
    toasts.show({ message, actionLabel: "Deshacer", onAction: () => undo(entryId) });
}
