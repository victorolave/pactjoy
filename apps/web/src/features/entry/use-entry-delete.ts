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
  const [deleted, setDeleted] = useState<string | null>(null);
  const [problem, setProblem] = useState<EntryProblem | null>(null);
  const removing = useRef(false);
  const confirmation = useRef("");

  const del = useDeleteEntry({
    onSuccess: () => {
      removing.current = false;
      setDeleted(confirmation.current);
    },
    onError: (error) => {
      removing.current = false;
      setProblem({ message: entryFailure(error, "borrar").message, kind: toUiError(error).kind });
    },
  });

  const remove: EntryDelete["remove"] = (text) => {
    if (removing.current) return;
    removing.current = true;
    confirmation.current = text;
    setProblem(null);
    del.mutate(entryId);
  };

  return { pending: del.isPending, deleted, problem, remove };
}
