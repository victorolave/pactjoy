import { useRef, useState } from "react";
import type { EntryValueInput } from "../../../ports/pactjoy-api.ts";
import { toUiError } from "../../../shared/ui-error.ts";
import { entryFailure } from "../entry-messages.ts";
import type { EntryProblem } from "../quantity/use-quantity-entry.ts";
import { useEditEntry } from "../queries.ts";

export interface EntryEdit {
  readonly pending: boolean;
  /** What to confirm once the change is saved; null until then. */
  readonly saved: string | null;
  readonly problem: EntryProblem | null;
  /** `photoId`: omitted keeps the entry's photo, `null` removes it, an id replaces it. */
  save(
    value: EntryValueInput,
    note: string | null,
    confirmation: string,
    photoId?: string | null,
  ): void;
}

/** Saves a change to one entry (PUT is idempotent, so a retry needs no request id). */
export function useEntryEdit(entryId: string): EntryEdit {
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<EntryProblem | null>(null);
  const saving = useRef(false);
  const confirmation = useRef("");

  const edit = useEditEntry({
    onSuccess: () => {
      saving.current = false;
      setSaved(confirmation.current);
    },
    onError: (error) => {
      saving.current = false;
      setProblem({ message: entryFailure(error).message, kind: toUiError(error).kind });
    },
  });

  const save: EntryEdit["save"] = (value, note, text, photoId) => {
    if (saving.current) return;
    saving.current = true;
    confirmation.current = text;
    setProblem(null);
    edit.mutate({ entryId, value, note, ...(photoId === undefined ? {} : { photoId }) });
  };

  return { pending: edit.isPending, saved, problem, save };
}
