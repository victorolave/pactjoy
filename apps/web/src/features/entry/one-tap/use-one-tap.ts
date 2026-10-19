import { useEffect, useRef, useState } from "react";
import { useHaptics } from "../../../context/haptics-context.tsx";
import { useIds } from "../../../context/ids-context.tsx";
import { useToasts } from "../../../context/toast-context.tsx";
import type { RecordEntryCommand } from "../../../ports/pactjoy-api.ts";
import { useTodayDates } from "../../../shared/today-date-context.tsx";
import {
  entryFailure,
  QUEUED_MISSED,
  QUEUED_MISSED_YESTERDAY,
  QUEUED_SAVED,
} from "../entry-messages.ts";
import { useSavedToast } from "../feedback/use-saved-toast.ts";
import { useRecordEntry } from "../queries.ts";

/** What the toast says once the answer is in: the server's confirmation, or the phone's when queued. */
interface Messages {
  readonly saved: string;
  readonly queued: string;
}

const SAVED: Messages = {
  saved: "Registro guardado. Un paso más en tu meta.",
  queued: QUEUED_SAVED,
};
const MISSED: Messages = { saved: "Anotado: hoy no salió.", queued: QUEUED_MISSED };
const MISSED_YESTERDAY_MESSAGES: Messages = {
  saved: "Anotado: ayer no salió.",
  queued: QUEUED_MISSED_YESTERDAY,
};

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
  /** Named in the notice if the server rejects the tap after it was kept on the phone. */
  habitName: string,
  /** The day the registro is for; the day on display unless it is yesterday's (design 15d). */
  forDate?: string,
): OneTap {
  const toasts = useToasts();
  const ids = useIds();
  const haptics = useHaptics();
  const dates = useTodayDates();
  const showSaved = useSavedToast({ habitName, forDate: forDate ?? dates?.refDate ?? null });
  const [message, setMessage] = useState<string | null>(null);
  const [optimisticDone, setOptimisticDone] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  // Set synchronously on the first tap: React state would still say "idle" for a fast second tap.
  const saving = useRef(false);
  // What the answer says about the tap in flight: read by the mutation's own callbacks.
  const inFlight = useRef<Messages>(SAVED);

  // The callbacks belong to the mutation, not to each `mutate` call: the toast still appears when the
  // row that tapped has moved or unmounted (a check in De ayer whose item leaves the list).
  const record = useRecordEntry(
    {
      onSuccess: ({ entryId: created, queued }) => {
        saving.current = false;
        setEntryId(created);
        // Kept on the phone: it will be sent when the connection is back; the toast still undoes it.
        showSaved(queued === true ? inFlight.current.queued : inFlight.current.saved, created);
      },
      onError: (error, command) => {
        saving.current = false;
        setOptimisticDone(false);
        const failure = entryFailure(error);
        if (!failure.retryable) {
          setMessage(failure.message);
          return;
        }
        const saved = inFlight.current;
        toasts.show({
          message: failure.message,
          tone: "error",
          durationMs: null,
          actionLabel: "Reintentar",
          actionWorksOffline: true,
          onAction: () => send(command, saved),
        });
      },
    },
    habitName,
  );

  // After a success the server's row should show the entry within a refetch; if it never does (the
  // entry vanished elsewhere), the fill lets go instead of lying.
  useEffect(() => {
    if (!optimisticDone || !record.isSuccess) return;
    const timer = setTimeout(() => setOptimisticDone(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [optimisticDone, record.isSuccess]);

  const send = (command: RecordEntryCommand, saved: Messages): void => {
    saving.current = true;
    inFlight.current = saved;
    setMessage(null);
    // The entry of the PREVIOUS tap is not this one's: undo must never reach for a stale id.
    setEntryId(null);
    if (command.value.kind === "done") {
      // The visual starts on the tap, not on the answer; only the data waits for the server.
      setOptimisticDone(true);
      haptics.tap();
    }
    record.mutate(command);
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
      kind === "done" ? SAVED : forDate === undefined ? MISSED : MISSED_YESTERDAY_MESSAGES,
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
