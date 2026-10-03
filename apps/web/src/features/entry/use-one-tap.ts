import { useEffect, useRef, useState } from "react";
import { useHaptics } from "../../app/haptics-context.tsx";
import { useIds } from "../../app/ids-context.tsx";
import { useToasts } from "../../app/toast-context.tsx";
import type { RecordEntryCommand } from "../../ports/pactjoy-api.ts";
import { useTodayDates } from "../today/today-date-context.tsx";
import { entryFailure } from "./entry-messages.ts";
import { useRecordEntry } from "./queries.ts";
import { useSavedToast } from "./use-saved-toast.ts";

const SAVED = "Registro guardado. Un paso más en tu meta.";
const MISSED_SAVED = "Anotado: hoy no salió.";

/** How long the fill waits for the refetched Today to show the entry before it lets go. */
const SETTLE_MS = 4000;

export interface OneTap {
  readonly pending: boolean;
  /** An inline message for a failure a retry cannot fix (the day closed, not allowed, ...). */
  readonly message: string | null;
  /**
   * The tap's visual, true from the tap itself until the server's own row shows the entry, so the
   * circle fills at once. The data stays the server's: a failure reverts it.
   */
  readonly optimisticDone: boolean;
  /** The entry the server created for the last tap, to undo it before Today is refetched. */
  readonly entryId: string | null;
  /** The refetched Today now shows the entry: the server's row takes over from the optimistic one. */
  settle(): void;
  done(): void;
  missed(): void;
}

/**
 * The one-tap flow for a done/not done day row: record, then a toast to undo. A retry of the same
 * tap reuses its clientRequestId, so it is an idempotent replay on the server (EN-R1).
 */
export function useOneTap(
  commitmentId: string,
  seasonId: string,
  /** The day the registro is for; the day on display unless it is yesterday's (design 15d). */
  forDate?: string,
): OneTap {
  const record = useRecordEntry();
  const toasts = useToasts();
  const showSaved = useSavedToast();
  const ids = useIds();
  const haptics = useHaptics();
  const dates = useTodayDates();
  const [message, setMessage] = useState<string | null>(null);
  const [optimisticDone, setOptimisticDone] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  // Set synchronously on the first tap: React state would still say "idle" for a fast second tap.
  const saving = useRef(false);

  // After a success the server's row should show the entry within a refetch; if it never does (the
  // entry vanished elsewhere), the fill lets go instead of lying.
  useEffect(() => {
    if (!optimisticDone || !record.isSuccess) return;
    const timer = setTimeout(() => setOptimisticDone(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [optimisticDone, record.isSuccess]);

  const send = (command: RecordEntryCommand, saved: string): void => {
    saving.current = true;
    setMessage(null);
    if (command.value.kind === "done") {
      // The visual starts on the tap, not on the answer; only the data waits for the server.
      setOptimisticDone(true);
      haptics.tap();
    }
    record.mutate(command, {
      onSuccess: ({ entryId: created }) => {
        saving.current = false;
        setEntryId(created);
        showSaved(saved, created);
      },
      onError: (error) => {
        saving.current = false;
        setOptimisticDone(false);
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
        ...(forDate !== undefined
          ? { forDate }
          : dates === undefined
            ? {}
            : { forDate: dates.refDate }),
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
    optimisticDone,
    entryId,
    settle: () => setOptimisticDone(false),
    done: () => start("done"),
    missed: () => start("missed"),
  };
}
