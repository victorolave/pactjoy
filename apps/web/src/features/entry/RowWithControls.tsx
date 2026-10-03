import type { TodayRow } from "@pactjoy/app";
import { useOnline } from "../../app/connectivity-context.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { TodayRowCard } from "../today/rows/TodayRowCard.tsx";
import { limitMeasureOf, quantityMeasureOf } from "./entry-form.ts";
import { useEntrySheet } from "./use-entry-sheet.ts";
import { useOneTap } from "./use-one-tap.ts";

/** A Today row plus its register controls: the one-tap pair for an open done/not done day row. */
export function RowWithControls({
  row,
  seasonId,
}: {
  readonly row: TodayRow;
  readonly seasonId: string;
}) {
  const oneTap = useOneTap(row.commitmentId, seasonId);
  const sheet = useEntrySheet();
  // No write queue (P1): every write control is off until the network is back.
  const online = useOnline();
  const offersOneTap =
    row.kind === "day" && row.measure.unit === "done" && row.opportunity.state === "open";
  const { state } = row.opportunity;
  const windowOpen =
    (state === "open" || state === "logged") && !(row.kind === "day" && !row.scheduledToday);
  // A reach quantity keeps its plus once logged: more minutes or pages the same day add up (design
  // 22). A limit is corrected from the edit, not summed on its grid.
  const offersSheet =
    windowOpen &&
    (quantityMeasureOf(row.measure) !== null ||
      (state === "open" && limitMeasureOf(row.measure) !== null));
  const firstEntry = row.entries[0];
  const offersEdit = firstEntry !== undefined && windowOpen;
  return (
    <TodayRowCard
      row={row}
      action={
        <>
          {offersOneTap && (
            <>
              <IconButton
                icon="check"
                variant="outline"
                label={`Registrar ${row.habitName}`}
                disabled={oneTap.pending || !online}
                onClick={oneTap.done}
              />
              <IconButton
                icon="x"
                label={`Hoy no salió: ${row.habitName}`}
                disabled={oneTap.pending || !online}
                onClick={oneTap.missed}
              />
            </>
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
        oneTap.message === null ? undefined : <InlineMessage tone="error" title={oneTap.message} />
      }
    />
  );
}
