import { useToasts } from "../../app/toast-context.tsx";
import { useDeleteEntry } from "./queries.ts";

/**
 * Undoes a registro by deleting that entry. It says so in a toast; a failure keeps its own toast with
 * Reintentar, so the user is never left unsure whether it went through. The toasts are the mutation's
 * own callbacks, so they still appear when the sheet or row that started the undo is long gone (the
 * Deshacer of a saved toast is tapped after its sheet closed).
 */
export function useUndoEntry(): (entryId: string) => void {
  const toasts = useToasts();
  const remove = useDeleteEntry({
    onSuccess: () => toasts.show({ message: "Registro deshecho." }),
    onError: (_error, entryId) =>
      toasts.show({
        message: "No pudimos deshacer el registro.",
        tone: "error",
        durationMs: null,
        actionLabel: "Reintentar",
        onAction: () => remove.mutate(entryId),
      }),
  });
  return (entryId) => remove.mutate(entryId);
}
