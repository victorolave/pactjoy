import type { TodayRow } from "@pactjoy/app";
import type { ReactNode } from "react";
import { DayRow } from "./DayRow.tsx";
import { PausedRow } from "./PausedRow.tsx";
import { WeekRow } from "./WeekRow.tsx";

export interface TodayRowCardProps {
  readonly row: TodayRow;
  /** Builds the register control for a row. It is only asked for rows that can still be written. */
  readonly actionFor?: (row: TodayRow) => ReactNode;
}

export function TodayRowCard({ row, actionFor }: TodayRowCardProps) {
  const { state } = row.opportunity;
  if (state === "paused" || state === "onHold") return <PausedRow row={row} />;
  const writable =
    (state === "open" || state === "logged") && !(row.kind === "day" && !row.scheduledToday);
  const action = writable ? actionFor?.(row) : undefined;
  return row.kind === "day" ? (
    <DayRow row={row} action={action} />
  ) : (
    <WeekRow row={row} action={action} />
  );
}
