import type { ReactNode } from "react";
import {
  entryText,
  quantityText,
  scheduleText,
  sumQuantities,
  targetText,
} from "../../../shared/row-labels.ts";
import { useTodayDate } from "../../../shared/today-date-context.tsx";
import { Tag } from "../../../ui/Tag.tsx";
import type { DayTodayRow } from "../today-view-model.ts";
import { RowFrame } from "./RowFrame.tsx";
import { SessionBar } from "./SessionBar.tsx";

/** "Llevas X hoy" for a reach (progress toward a goal); "Hoy: X" for a limit (an amount, not a goal). */
const dayTotalText = (amount: string, measure: DayTodayRow["measure"]): string =>
  measure.unit !== "done" && measure.target.direction === "limit"
    ? `Hoy: ${amount}`
    : `Llevas ${amount} hoy`;

export function DayRow({
  row,
  action,
  below,
  optimisticDone = false,
}: {
  readonly row: DayTodayRow;
  readonly optimisticDone?: boolean;
  readonly action?: ReactNode;
  readonly below?: ReactNode;
}) {
  const { state } = row.opportunity;
  const today = useTodayDate();
  const logged = state === "logged" && row.entries.length > 0;
  // A "Hoy no salió" is a registered day, not a success: it gets no check and no success colour.
  const achieved =
    optimisticDone || (logged && row.entries.some((entry) => entry.value.kind !== "missed"));
  const lines = (missed: boolean) =>
    row.entries
      .filter((entry) => (entry.value.kind === "missed") === missed)
      .map((entry) => entryText(entry, row.measure, today));
  // Logged rows weigh one line: several quantities of today read "Llevas 35 min hoy" (design 22).
  // A limit is not a goal to reach, so it reads "Hoy: 1 vez" instead.
  const quantities = row.entries.filter((entry) => entry.value.kind === "quantity");
  const sumsUp =
    achieved &&
    quantities.length > 0 &&
    quantities.length === row.entries.length &&
    quantities.every((entry) => today === undefined || entry.forDate === today);
  const statuses = !achieved
    ? []
    : row.entries.length === 0
      ? ["Registrado hoy"]
      : sumsUp
        ? [dayTotalText(quantityText(sumQuantities(quantities), row.measure), row.measure)]
        : lines(false);
  const detail = !row.scheduledToday
    ? "No toca hoy"
    : state === "closed"
      ? "Cerrado"
      : (targetText(row.measure) ?? scheduleText(row.measure));
  return (
    <RowFrame
      title={row.habitName}
      commitmentId={row.commitmentId}
      glyph={achieved ? "check" : logged ? "x" : "repeat"}
      tone={achieved ? "done" : "default"}
      statuses={statuses}
      points={achieved ? row.points.earned : null}
      details={logged || achieved ? lines(true) : [detail]}
      badges={row.privacy === "private" ? <Tag>Privado</Tag> : undefined}
      action={action}
      below={
        <>
          <SessionBar row={row} />
          {below}
        </>
      }
    />
  );
}
