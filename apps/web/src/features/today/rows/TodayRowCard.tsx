import type { TodayRow } from "@pactjoy/app";
import type { ReactNode } from "react";
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
}

export function TodayRowCard({ row, action, below, optimisticDone = false }: TodayRowCardProps) {
  const { state } = row.opportunity;
  if (state === "paused" || state === "onHold") return <PausedRow row={row} />;
  const writable =
    (state === "open" || state === "logged") && !(row.kind === "day" && !row.scheduledToday);
  const controls = writable ? { action, below } : {};
  return row.kind === "day" ? (
    <DayRow row={row} optimisticDone={optimisticDone} {...controls} />
  ) : (
    <WeekRow row={row} {...controls} />
  );
}
