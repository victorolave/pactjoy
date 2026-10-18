import { useRef, useState } from "react";
import { useToasts } from "../../../context/toast-context.tsx";
import { toUiError } from "../../../shared/ui-error.ts";
import { entryFailure, QUEUED_DELETED } from "../entry-messages.ts";
import type { EntryProblem } from "../quantity/use-quantity-entry.ts";
import { type EntryContext, useDeleteEntry } from "../queries.ts";

export interface EntryDelete {
  readonly pending: boolean;
  /** What to confirm once the entry is gone; null until then. */
  readonly deleted: string | null;
  readonly problem: EntryProblem | null;
  remove(confirmation: string): void;
}

/**
 * Deletes one entry. The toast that says so belongs to the mutation, not to the sheet: a deletion
 * kept on the phone hides the entry at once, which can close the sheet before this component sees
 * the answer.
 */
export function useEntryDelete(entryId: string, context: EntryContext): EntryDelete {
  const toasts = useToasts();
  const [deleted, setDeleted] = useState<string | null>(null);
  const [problem, setProblem] = useState<EntryProblem | null>(null);
  const removing = useRef(false);
  const confirmation = useRef("");

  const del = useDeleteEntry(
    {
      onSuccess: (outcome) => {
        removing.current = false;
        toasts.show({ message: outcome.queued ? QUEUED_DELETED : "Registro borrado." });
        setDeleted(confirmation.current);
      },
      onError: (error) => {
        removing.current = false;
        setProblem({
          message: entryFailure(error, "borrar").message,
          kind: toUiError(error).kind,
        });
      },
    },
    context,
  );

  const remove: EntryDelete["remove"] = (text) => {
    if (removing.current) return;
    removing.current = true;
    confirmation.current = text;
    setProblem(null);
    del.mutate(entryId);
  };

  return { pending: del.isPending, deleted, problem, remove };
}
