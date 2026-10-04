import { useRef, useState } from "react";
import { useIds } from "../../../context/ids-context.tsx";
import type { EntryValueInput } from "../../../ports/pactjoy-api.ts";
import { useTodayDates } from "../../../shared/today-date-context.tsx";
import { toUiError, type UiKind } from "../../../shared/ui-error.ts";
import { entryFailure } from "../entry-messages.ts";
import { useRecordEntry } from "../queries.ts";

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
export function useQuantityEntry(
  commitmentId: string,
  seasonId: string,
  /** The day to record for when it is not the day on display (yesterday, design 21). */
  forDate?: string,
): QuantityEntry {
  const ids = useIds();
  const dates = useTodayDates();
  const [saved, setSaved] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [problem, setProblem] = useState<EntryProblem | null>(null);
  const attempt = useRef<{ readonly signature: string; readonly id: string } | null>(null);
  const saving = useRef(false);
  const confirmation = useRef("");

  // The answer is handled by the mutation itself, mounted or not (see `WriteCallbacks`).
  const record = useRecordEntry({
    onSuccess: (recorded) => {
      saving.current = false;
      attempt.current = null;
      setEntryId(recorded.entryId);
      setSaved(confirmation.current);
    },
    onError: (error) => {
      saving.current = false;
      setProblem({ message: entryFailure(error).message, kind: toUiError(error).kind });
    },
  });

  const submit: QuantityEntry["submit"] = (value, note, text) => {
    if (saving.current) return;
    // The day is part of what is being resent: the same value for another day is another entry.
    const day = forDate ?? dates?.refDate ?? null;
    const signature = JSON.stringify([value, note, day]);
    const id = attempt.current?.signature === signature ? attempt.current.id : ids.newId();
    attempt.current = { signature, id };
    saving.current = true;
    confirmation.current = text;
    setProblem(null);
    record.mutate({
      seasonId,
      commitmentId,
      ...(day === null ? {} : { forDate: day }),
      value,
      note,
      clientRequestId: id,
    });
  };

  return { pending: record.isPending, saved, entryId, problem, submit };
}
