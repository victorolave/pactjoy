import { useToasts } from "../../app/toast-context.tsx";
import { useDeleteEntry } from "./queries.ts";

/**
 * The toast that follows a new registro (design 16, 20): the message and Deshacer. Undoing deletes
 * that entry; a failure keeps its own toast with Reintentar, so the user is never left unsure.
 */
export function useSavedToast(): (message: string, entryId: string) => void {
  const remove = useDeleteEntry();
  const toasts = useToasts();

  const undo = (entryId: string): void => {
    remove.mutate(entryId, {
      onSuccess: () => toasts.show({ message: "Registro deshecho." }),
      onError: () =>
        toasts.show({
          message: "No pudimos deshacer el registro.",
          tone: "error",
          durationMs: null,
          actionLabel: "Reintentar",
          onAction: () => undo(entryId),
        }),
    });
  };

  return (message, entryId) =>
    toasts.show({ message, actionLabel: "Deshacer", onAction: () => undo(entryId) });
}
