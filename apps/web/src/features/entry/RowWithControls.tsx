import type { TodayRow } from "@pactjoy/app";
import { IconButton } from "../../ui/IconButton.tsx";
import { InlineMessage } from "../../ui/InlineMessage.tsx";
import { TodayRowCard } from "../today/rows/TodayRowCard.tsx";
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
  const offersOneTap =
    row.kind === "day" && row.measure.unit === "done" && row.opportunity.state === "open";
  return (
    <TodayRowCard
      row={row}
      action={
        offersOneTap ? (
          <>
            <IconButton
              icon="check"
              variant="outline"
              label={`Registrar ${row.habitName}`}
              disabled={oneTap.pending}
              onClick={oneTap.done}
            />
            <IconButton
              icon="x"
              label={`Hoy no salió: ${row.habitName}`}
              disabled={oneTap.pending}
              onClick={oneTap.missed}
            />
          </>
        ) : undefined
      }
      below={
        oneTap.message === null ? undefined : <InlineMessage tone="error" title={oneTap.message} />
      }
    />
  );
}
