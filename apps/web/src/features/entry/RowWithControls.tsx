import type { TodayRow } from "@pactjoy/app";
import { useState } from "react";
import { useOnline } from "../../app/connectivity-context.tsx";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { TodayRowCard } from "../today/rows/TodayRowCard.tsx";
import { CheckCircle } from "./CheckCircle.tsx";
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
  const offersCircle = isDone && windowOpen && (state === "open" || doneEntry !== undefined);
  const offersMissed = isDone && windowOpen && state === "open";
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
        action={
          <>
            {offersCircle && (
              <CheckCircle
                label={`Registrar ${row.habitName}`}
                pressed={doneEntry !== undefined}
                disabled={oneTap.pending || !online}
                onClick={doneEntry === undefined ? oneTap.done : () => setConfirmingUndo(true)}
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
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Hoy no salió: ${row.habitName}`}
                disabled={oneTap.pending || !online}
                onClick={oneTap.missed}
              >
                Hoy no salió
              </Button>
            )}
            {oneTap.message !== null && <InlineMessage tone="error" title={oneTap.message} />}
          </>
        }
      />
      {confirmingUndo && doneEntry !== undefined && (
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
                  undo(doneEntry.entryId);
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
