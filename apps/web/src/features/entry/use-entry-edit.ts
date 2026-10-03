import { useRef, useState } from "react";
import type { EntryValueInput } from "../../ports/pactjoy-api.ts";
import { toUiError } from "../../shared/ui-error.ts";
import { entryFailure } from "./entry-messages.ts";
import { useEditEntry } from "./queries.ts";
import type { EntryProblem } from "./use-quantity-entry.ts";

export interface EntryEdit {
  readonly pending: boolean;
  /** What to confirm once the change is saved; null until then. */
  readonly saved: string | null;
  readonly problem: EntryProblem | null;
  save(value: EntryValueInput, note: string | null, confirmation: string): void;
}

/** Saves a change to one entry (PUT is idempotent, so a retry needs no request id). */
export function useEntryEdit(entryId: string): EntryEdit {
  const edit = useEditEntry();
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<EntryProblem | null>(null);
  const saving = useRef(false);

  const save: EntryEdit["save"] = (value, note, confirmation) => {
    if (saving.current) return;
    saving.current = true;
    setProblem(null);
    edit.mutate(
      { entryId, value, note },
      {
        onSuccess: () => {
          saving.current = false;
          setSaved(confirmation);
        },
        onError: (error) => {
          saving.current = false;
          setProblem({ message: entryFailure(error).message, kind: toUiError(error).kind });
        },
      },
    );
  };

  return { pending: edit.isPending, saved, problem, save };
}
