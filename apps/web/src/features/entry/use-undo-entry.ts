import { useToasts } from "../../app/toast-context.tsx";
import { useDeleteEntry } from "./queries.ts";

/**
 * Undoes a registro by deleting that entry. It says so in a toast; a failure keeps its own toast with
 * Reintentar, so the user is never left unsure whether it went through.
 */
export function useUndoEntry(): (entryId: string) => void {
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
  return undo;
}
