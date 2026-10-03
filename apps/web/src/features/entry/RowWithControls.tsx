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
  const offersSheet =
    row.opportunity.state === "open" &&
    !(row.kind === "day" && !row.scheduledToday) &&
    (quantityMeasureOf(row.measure) !== null || limitMeasureOf(row.measure) !== null);
  const firstEntry = row.entries[0];
  const offersEdit =
    firstEntry !== undefined &&
    (row.opportunity.state === "open" || row.opportunity.state === "logged") &&
    !(row.kind === "day" && !row.scheduledToday);
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
