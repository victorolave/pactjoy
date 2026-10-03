import type { TodayRow } from "@pactjoy/app";
import { useEffect, useState } from "react";
import { useOnline } from "../../app/connectivity-context.tsx";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { TodayRowCard } from "../today/rows/TodayRowCard.tsx";
import { CheckCircle } from "./CheckCircle.tsx";
import styles from "./check-circle.module.css";
import { limitMeasureOf, quantityMeasureOf } from "./entry-form.ts";
import { useEntrySheet } from "./use-entry-sheet.ts";
import { useOneTap } from "./use-one-tap.ts";
import { useUndoEntry } from "./use-undo-entry.ts";

/**
 * A Today row plus its register controls: the one-tap circle of a done/not done day (a second tap on
 * a filled one undoes it, design 16) and the plus and edit of a quantity.
 */
export function RowWithControls({
  row,
  seasonId,
}: {
  readonly row: TodayRow;
  readonly seasonId: string;
}) {
  const oneTap = useOneTap(row.commitmentId, seasonId);
  const undo = useUndoEntry();
  const sheet = useEntrySheet();
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  // No write queue (P1): every write control is off until the network is back.
  const online = useOnline();
  const { state } = row.opportunity;
  const windowOpen =
    (state === "open" || state === "logged") && !(row.kind === "day" && !row.scheduledToday);
  const isDone = row.kind === "day" && row.measure.unit === "done";
  const doneEntry = row.entries.find((entry) => entry.value.kind === "done");
  // Open: the first tap records. Logged with a real done: pressed, and a second tap undoes it. A day
  // marked "Hoy no salió" has no circle: that registro is edited, not toggled.
  const filled = doneEntry !== undefined || oneTap.optimisticDone;
  const undoId = doneEntry?.entryId ?? oneTap.entryId;
  const offersCircle = isDone && windowOpen && (state === "open" || filled);
  // Hoy no salió stays mounted through the tap and collapses, so the row never jumps in height.
  const offersMissed = isDone && windowOpen;
  const missedOpen = state === "open" && !oneTap.optimisticDone;
  // The server's own row takes over from the optimistic fill once it shows the entry.
  const { settle, optimisticDone } = oneTap;
  useEffect(() => {
    if (optimisticDone && doneEntry !== undefined) settle();
  }, [optimisticDone, doneEntry, settle]);
  // A reach quantity keeps its plus once logged: more minutes or pages the same day add up (design
  // 22). A limit is corrected from the edit, not summed on its grid.
  const offersSheet =
    windowOpen &&
    (quantityMeasureOf(row.measure) !== null ||
      (state === "open" && limitMeasureOf(row.measure) !== null));
  const firstEntry = row.entries[0];
  const offersEdit = firstEntry !== undefined && windowOpen;
  return (
    <>
      <TodayRowCard
        row={row}
        optimisticDone={oneTap.optimisticDone}
        action={
          <>
            {offersCircle && (
              <CheckCircle
                label={`Registrar ${row.habitName}`}
                pressed={filled}
                disabled={!online}
                onClick={
                  !filled ? oneTap.done : undoId === null ? () => {} : () => setConfirmingUndo(true)
                }
              />
            )}
            {offersSheet && (
              <IconButton
                icon="plus"
                variant="outline"
                label={`Registrar ${row.habitName}`}
                disabled={!online}
                onClick={() => sheet.open(row.commitmentId)}
              />
            )}
            {offersEdit && (
              <IconButton
                icon="pencil"
                label={`Editar registro de ${row.habitName}`}
                disabled={!online}
                onClick={() => sheet.open(row.commitmentId, firstEntry.entryId)}
              />
            )}
          </>
        }
        below={
          <>
            {offersMissed && (
              <div
                className={styles.collapse}
                data-open={missedOpen}
                aria-hidden={missedOpen ? undefined : true}
              >
                <div className={styles.collapseInner}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Hoy no salió: ${row.habitName}`}
                    disabled={!missedOpen || oneTap.pending || !online}
                    onClick={oneTap.missed}
                  >
                    Hoy no salió
                  </Button>
                </div>
              </div>
            )}
            {oneTap.message !== null && <InlineMessage tone="error" title={oneTap.message} />}
          </>
        }
      />
      {confirmingUndo && undoId !== null && (
        <Sheet
          open
          placement="center"
          title="¿Deshacer registro?"
          onClose={() => setConfirmingUndo(false)}
          actions={
            <>
              <Button
                block
                onClick={() => {
                  setConfirmingUndo(false);
                  undo(undoId);
                }}
              >
                Deshacer registro
              </Button>
              <Button variant="ghost" block onClick={() => setConfirmingUndo(false)}>
                Cancelar
              </Button>
            </>
          }
        >
          <p>{`Se quita el registro de ${row.habitName} de hoy.`}</p>
        </Sheet>
      )}
    </>
  );
}
