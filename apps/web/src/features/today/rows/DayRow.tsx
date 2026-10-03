import type { ReactNode } from "react";
import { Tag } from "../../../ui/Tag.tsx";
import { entryText, scheduleText, targetText } from "../row-labels.ts";
import { useTodayDate } from "../today-date-context.tsx";
import type { DayTodayRow } from "../today-view-model.ts";
import { RowFrame } from "./RowFrame.tsx";

export function DayRow({
  row,
  action,
  below,
}: {
  readonly row: DayTodayRow;
  readonly action?: ReactNode;
  readonly below?: ReactNode;
}) {
  const { state } = row.opportunity;
  const today = useTodayDate();
  const logged = state === "logged" && row.entries.length > 0;
  // A "Hoy no salió" is a registered day, not a success: it gets no check and no success colour.
  const achieved = logged && row.entries.some((entry) => entry.value.kind !== "missed");
  const lines = (missed: boolean) =>
    row.entries
      .filter((entry) => (entry.value.kind === "missed") === missed)
      .map((entry) => entryText(entry, row.measure, today));
  const detail = !row.scheduledToday
    ? "No toca hoy"
    : state === "closed"
      ? "Cerrado"
      : (targetText(row.measure) ?? scheduleText(row.measure));
  return (
    <RowFrame
      title={row.habitName}
      glyph={achieved ? "check" : logged ? "x" : "repeat"}
      tone={achieved ? "done" : "default"}
      statuses={achieved ? lines(false) : []}
      details={logged ? lines(true) : [detail]}
      badges={row.privacy === "private" ? <Tag>Privado</Tag> : undefined}
      action={action}
      below={below}
    />
  );
}
