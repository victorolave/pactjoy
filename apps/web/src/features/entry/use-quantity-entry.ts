import { useRef, useState } from "react";
import { useIds } from "../../app/ids-context.tsx";
import type { EntryValueInput } from "../../ports/pactjoy-api.ts";
import { toUiError, type UiKind } from "../../shared/ui-error.ts";
import { useTodayDates } from "../today/today-date-context.tsx";
import { entryFailure } from "./entry-messages.ts";
import { useRecordEntry } from "./queries.ts";

export interface EntryProblem {
  readonly message: string;
  readonly kind: UiKind;
}

export interface QuantityEntry {
  readonly pending: boolean;
  readonly saved: string | null;
  /** The id of the entry just recorded, to undo it. */
  readonly entryId: string | null;
  readonly problem: EntryProblem | null;
  submit(value: EntryValueInput, note: string | null, confirmation: string): void;
}

/** Resending the same entry after a failure reuses its clientRequestId; a changed one gets a new id. */
export function useQuantityEntry(commitmentId: string, seasonId: string): QuantityEntry {
  const record = useRecordEntry();
  const ids = useIds();
  const dates = useTodayDates();
  const [saved, setSaved] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [problem, setProblem] = useState<EntryProblem | null>(null);
  const attempt = useRef<{ readonly signature: string; readonly id: string } | null>(null);
  const saving = useRef(false);

  const submit: QuantityEntry["submit"] = (value, note, confirmation) => {
    if (saving.current) return;
    const signature = JSON.stringify([value, note]);
    const id = attempt.current?.signature === signature ? attempt.current.id : ids.newId();
    attempt.current = { signature, id };
    saving.current = true;
    setProblem(null);
    record.mutate(
      {
        seasonId,
        commitmentId,
        ...(dates === undefined ? {} : { forDate: dates.refDate }),
        value,
        note,
        clientRequestId: id,
      },
      {
        onSuccess: (recorded) => {
          saving.current = false;
          attempt.current = null;
          setEntryId(recorded.entryId);
          setSaved(confirmation);
        },
        onError: (error) => {
          saving.current = false;
          setProblem({ message: entryFailure(error).message, kind: toUiError(error).kind });
        },
      },
    );
  };

  return { pending: record.isPending, saved, entryId, problem, submit };
}
