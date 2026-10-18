import type { TodayRow } from "@pactjoy/app";
import type { ReactNode } from "react";
import type { PendingKind } from "../../entry/index.ts";
import { RowPauseActions } from "../../pause/index.ts";
import { DayRow } from "./DayRow.tsx";
import { PausedRow } from "./PausedRow.tsx";
import { WeekRow } from "./WeekRow.tsx";

export interface TodayRowCardProps {
  readonly row: TodayRow;
  /** Trailing register control. Only shown for rows that can still be written. */
  readonly action?: ReactNode;
  /** Content under the row (an inline error). Only shown for rows that can still be written. */
  readonly below?: ReactNode;
  /** The tap's own fill, before the server's row shows the entry: a day row looks registered. */
  readonly optimisticDone?: boolean;
  /** A change waiting on the phone for this row (design 15g): its line and badge. */
  readonly pending?: PendingKind | undefined;
}

export function TodayRowCard({
  row,
  action,
  below,
  optimisticDone = false,
  pending,
}: TodayRowCardProps) {
  const { state } = row.opportunity;
  if (state === "paused" || state === "onHold") return <PausedRow row={row} />;
  const writable =
    (state === "open" || state === "logged") && !(row.kind === "day" && !row.scheduledToday);
  // A pause still ahead leaves the row as it is, and the member may still back out of it (PS-12).
  const ahead =
    row.pause === null ? null : (
      <RowPauseActions
        pause={row.pause}
        commitmentId={row.commitmentId}
        habitName={row.habitName}
      />
    );
  const underneath =
    ahead === null ? (
      writable ? (
        below
      ) : undefined
    ) : (
      <>
        {writable ? below : null}
        {ahead}
      </>
    );
  const controls = {
    ...(writable ? { action } : {}),
    ...(underneath === undefined ? {} : { below: underneath }),
  };
  return row.kind === "day" ? (
    <DayRow row={row} optimisticDone={optimisticDone} pending={pending} {...controls} />
  ) : (
    <WeekRow row={row} pending={pending} {...controls} />
  );
}
