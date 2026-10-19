import { useToasts } from "../../../context/toast-context.tsx";
import { QUEUED_UNDONE } from "../entry-messages.ts";
import { isLocalRef } from "../outbox/queue.ts";
import { type EntryContext, useDeleteEntry } from "../queries.ts";

/**
 * Undoes a registro by deleting that entry. It says so in a toast; a failure keeps its own toast with
 * Reintentar, so the user is never left unsure whether it went through. The toasts are the mutation's
 * own callbacks, so they still appear when the sheet or row that started the undo is long gone (the
 * Deshacer of a saved toast is tapped after its sheet closed). Entry writes are queued offline, so
 * both actions keep working without a connection.
 */
export function useUndoEntry(context: EntryContext): (entryId: string) => void {
  const toasts = useToasts();
  const remove = useDeleteEntry(
    {
      onSuccess: ({ queued }, entryId) =>
        toasts.show({
          // A record still on the phone just disappears; only a server entry waits to be deleted.
          message: queued && !isLocalRef(entryId) ? QUEUED_UNDONE : "Registro deshecho.",
        }),
      onError: (_error, entryId) =>
        toasts.show({
          message: "No pudimos deshacer el registro.",
          tone: "error",
          durationMs: null,
          actionLabel: "Reintentar",
          actionWorksOffline: true,
          onAction: () => remove.mutate(entryId),
        }),
    },
    context,
  );
  return (entryId) => remove.mutate(entryId);
}
