import { useRef, useState } from "react";
import { toUiError } from "../../../shared/ui-error.ts";
import { entryFailure } from "../entry-messages.ts";
import type { EntryProblem } from "../quantity/use-quantity-entry.ts";
import { type EntryContext, useDeleteEntry } from "../queries.ts";

export interface EntryDelete {
  readonly pending: boolean;
  /** What to confirm once the entry is gone; null until then. */
  readonly deleted: string | null;
  /** The deletion was kept on the phone, to be sent when the connection is back. */
  readonly queued: boolean;
  readonly problem: EntryProblem | null;
  remove(confirmation: string): void;
}

export function useEntryDelete(entryId: string, context: EntryContext): EntryDelete {
  const [deleted, setDeleted] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [problem, setProblem] = useState<EntryProblem | null>(null);
  const removing = useRef(false);
  const confirmation = useRef("");

  const del = useDeleteEntry(
    {
      onSuccess: (outcome) => {
        removing.current = false;
        setQueued(outcome.queued);
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

  return { pending: del.isPending, deleted, queued, problem, remove };
}
