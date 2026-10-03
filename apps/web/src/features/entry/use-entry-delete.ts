import { useRef, useState } from "react";
import { toUiError } from "../../shared/ui-error.ts";
import { entryFailure } from "./entry-messages.ts";
import { useDeleteEntry } from "./queries.ts";
import type { EntryProblem } from "./use-quantity-entry.ts";

export interface EntryDelete {
  readonly pending: boolean;
  /** What to confirm once the entry is gone; null until then. */
  readonly deleted: string | null;
  readonly problem: EntryProblem | null;
  remove(confirmation: string): void;
}

export function useEntryDelete(entryId: string): EntryDelete {
  const del = useDeleteEntry();
  const [deleted, setDeleted] = useState<string | null>(null);
  const [problem, setProblem] = useState<EntryProblem | null>(null);
  const removing = useRef(false);

  const remove: EntryDelete["remove"] = (confirmation) => {
    if (removing.current) return;
    removing.current = true;
    setProblem(null);
    del.mutate(entryId, {
      onSuccess: () => {
        removing.current = false;
        setDeleted(confirmation);
      },
      onError: (error) => {
        removing.current = false;
        setProblem({ message: entryFailure(error, "borrar").message, kind: toUiError(error).kind });
      },
    });
  };

  return { pending: del.isPending, deleted, problem, remove };
}
