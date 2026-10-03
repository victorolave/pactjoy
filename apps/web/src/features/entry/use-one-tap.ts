import { useRef, useState } from "react";
import { useIds } from "../../app/ids-context.tsx";
import { useToasts } from "../../app/toast-context.tsx";
import type { RecordEntryCommand } from "../../ports/pactjoy-api.ts";
import { useTodayDates } from "../today/today-date-context.tsx";
import { entryFailure } from "./entry-messages.ts";
import { useRecordEntry } from "./queries.ts";
import { useSavedToast } from "./use-saved-toast.ts";

const SAVED = "Registro guardado. Un paso más en tu meta.";
const MISSED_SAVED = "Anotado: hoy no salió.";

export interface OneTap {
  readonly pending: boolean;
  /** An inline message for a failure a retry cannot fix (the day closed, not allowed, ...). */
  readonly message: string | null;
  done(): void;
  missed(): void;
}

/**
 * The one-tap flow for a done/not done day row: record, then a toast to undo. A retry of the same
 * tap reuses its clientRequestId, so it is an idempotent replay on the server (EN-R1).
 */
export function useOneTap(commitmentId: string, seasonId: string): OneTap {
  const record = useRecordEntry();
  const toasts = useToasts();
  const showSaved = useSavedToast();
  const ids = useIds();
  const dates = useTodayDates();
  const [message, setMessage] = useState<string | null>(null);
  // Set synchronously on the first tap: React state would still say "idle" for a fast second tap.
  const saving = useRef(false);

  const send = (command: RecordEntryCommand, saved: string): void => {
    saving.current = true;
    setMessage(null);
    record.mutate(command, {
      onSuccess: ({ entryId }) => {
        saving.current = false;
        showSaved(saved, entryId);
      },
      onError: (error) => {
        saving.current = false;
        const failure = entryFailure(error);
        if (!failure.retryable) {
          setMessage(failure.message);
          return;
        }
        toasts.show({
          message: failure.message,
          tone: "error",
          durationMs: null,
          actionLabel: "Reintentar",
          onAction: () => send(command, saved),
        });
      },
    });
  };

  const start = (kind: "done" | "missed"): void => {
    if (saving.current) return;
    send(
      {
        seasonId,
        commitmentId,
        ...(dates === undefined ? {} : { forDate: dates.refDate }),
        value: { kind },
        note: null,
        clientRequestId: ids.newId(),
      },
      kind === "done" ? SAVED : MISSED_SAVED,
    );
  };

  return {
    pending: record.isPending,
    message,
    done: () => start("done"),
    missed: () => start("missed"),
  };
}
